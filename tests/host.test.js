import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createService} from '../host/service.js';
import {projectHistory} from '../host/runtime-adapter.js';
const request=(method,params={})=>({protocolVersion:1,requestId:'req',method,params});
async function fixture(t) {
 const stateDirectory=await mkdtemp(join(process.cwd(),'.host-test-'));t.after(()=>rm(stateDirectory,{recursive:true,force:true}));
 const rows=[{id:'ordinary',path:join(stateDirectory,'real'),title:'Real',sessionIds:['existing'] }];
 const sessions=[{sessionId:'existing',cwd:rows[0].path},{sessionId:'unrelated'},{sessionId:'other',cwd:'C:/elsewhere'}];let prompts=0;let createOptions;let fail=false;
 const adapter={projects:async()=>rows,listSessions:async()=>sessions,createSession:async options=>{createOptions=options;const id='new';sessions.push({sessionId:id,cwd:options.cwd});return {sessionId:id};},readSession:async id=>({messages:[{id:'m',role:'assistant',text:id}],running:false}),prompt:async()=>{prompts++;if(fail)throw new Error('lost connection');},cancel:async()=>{},watchSession:()=>()=>{}};
 return {stateDirectory,adapter,rows,get prompts(){return prompts;},get createOptions(){return createOptions;},set fail(v){fail=v;}};
}
test('private default project is stable, has its own directory, and never registers a workspace',async t=>{
 const f=await fixture(t);let s=await createService(f);let p=(await s.handle(request('projects.list'))).result.projects;assert.equal(p[0].id,'default');assert.equal(p[0].path,join(f.stateDirectory,'default-project'));await s.handle(request('sessions.create',{projectId:'default'}));assert.deepEqual(f.createOptions,{cwd:p[0].path});await s.close();s=await createService(f);assert.equal((await s.handle(request('projects.list'))).result.projects[0].path,p[0].path);assert.equal(f.rows.length,1);await s.close();
});
test('session reads and sends reject unrelated sessions including sessions without cwd',async t=>{
 const f=await fixture(t);const s=await createService(f);t.after(()=>s.close());
 assert.equal((await s.handle(request('sessions.read',{sessionId:'unrelated'}))).error.code,'SESSION_NOT_ALLOWED');assert.equal((await s.handle(request('sessions.read',{sessionId:'other'}))).error.code,'SESSION_NOT_ALLOWED');assert.equal((await s.handle(request('sessions.list',{projectId:'ordinary'}))).result.sessions.length,1);assert.equal((await s.handle(request('sessions.read',{sessionId:'existing'}))).result.messages[0].text,'existing');
});
test('persisted message IDs prevent duplicate admission after uncertain outcome and restart',async t=>{
 const f=await fixture(t);let s=await createService(f);f.fail=true;const send=request('messages.send',{sessionId:'existing',messageId:'one',text:'hello',contexts:[]});assert.equal((await s.handle(send)).error.code,'SEND_UNCERTAIN');await s.close();s=await createService(f);t.after(()=>s.close());assert.equal((await s.handle(request('messages.status',{sessionId:'existing',messageId:'one'}))).result.status,'unknown');assert.equal((await s.handle(send)).error.code,'SEND_UNCERTAIN');assert.equal(f.prompts,1);
});
test('concurrent duplicate message IDs admit once and retain accepted status',async t=>{
 const f=await fixture(t);const s=await createService(f);t.after(()=>s.close());const send=request('messages.send',{sessionId:'existing',messageId:'one',text:'hello',contexts:[]});const results=await Promise.all([s.handle(send),s.handle(send)]);assert.ok(results.every(r=>r.result.status==='accepted'));assert.equal(f.prompts,1);assert.equal(JSON.parse(await readFile(join(f.stateDirectory,'state.json'),'utf8')).sends.existing.one.status,'accepted');
});
test('corrupt metadata is not silently discarded',async t=>{const f=await fixture(t);await writeFile(join(f.stateDirectory,'state.json'),'{bad');await assert.rejects(()=>createService(f));});
test('history projection renders durable message, tool result, approval and streamed assistant text',()=>{
 const records=[{type:'event',event:{seq:0,type:'user/message',data:{role:'user',content:[{type:'text',text:'hello'}]}}},{type:'event',event:{seq:1,type:'assistant/message',data:{message:{role:'assistant',content:[{type:'text',text:'answer'}]}}}}];
 assert.equal(projectHistory(records).filter(x=>x.role==='user')[0].text,'hello');
});
import {connect} from 'node:net';
import {startIpc} from '../host/ipc.js';
import {encodeFrame,FrameDecoder} from '../native/framing.js';
function connection(pipe){const socket=connect(pipe);const pending=[];const frames=[];socket.on('data',data=>decoder.push(data));const decoder=new FrameDecoder(v=>pending.length?pending.shift()(v):frames.push(v));return {socket,next:()=>frames.length?Promise.resolve(frames.shift()):new Promise(resolve=>pending.push(resolve))};}
test('IPC rejects unauthenticated requests and removes only its own discovery record',async t=>{
 const f=await fixture(t);let calls=0;const service={handle:async request=>{calls++;return {protocolVersion:1,requestId:request.requestId,result:{ok:true}};},subscribe:()=>()=>{}};const ipc=await startIpc({service,stateDirectory:f.stateDirectory});t.after(()=>ipc.close());
 const files=await import('node:fs/promises').then(fs=>fs.readdir(join(f.stateDirectory,'instances')));assert.equal(files.length,1);const record=JSON.parse(await readFile(join(f.stateDirectory,'instances',files[0]),'utf8'));assert.equal(record.protocolVersion,1);const bad=connection(record.pipe);bad.socket.on('error',()=>{});bad.socket.write(encodeFrame(request('projects.list')));await new Promise(resolve=>bad.socket.on('close',resolve));assert.equal(calls,0);
 const good=connection(record.pipe);t.after(()=>good.socket.destroy());good.socket.write(encodeFrame({kind:'authenticate',token:record.token}));assert.deepEqual(await good.next(),{kind:'authenticated'});good.socket.write(encodeFrame(request('projects.list')));assert.equal((await good.next()).result.ok,true);await writeFile(join(f.stateDirectory,'instances','other.json'),'{}');await ipc.close();assert.deepEqual(await import('node:fs/promises').then(fs=>fs.readdir(join(f.stateDirectory,'instances'))),['other.json']);
});
import {activate} from '../host/index.js';
test('plugin waits for setup and registers disposal before asynchronous activation',async t=>{
 const f=await fixture(t);let cleanup;const ctx={effect(callback){cleanup=callback();},sessionController:{},workspaceRegistry:{}};let release;const opening=new Promise(resolve=>release=resolve);let disposed=false;
 const activation=activate(ctx,{stateDirectory:f.stateDirectory,autoSetup:false},{createAdapter:()=>f.adapter,startIpc:async()=>{await opening;return {close:async()=>{disposed=true;}};}});assert.equal(typeof cleanup,'function');release();await activation;await cleanup();assert.equal(disposed,true);
});
test('history response stays below native messaging limit and special message IDs stay distinct',async t=>{
 const f=await fixture(t);f.adapter.readSession=async()=>({messages:Array.from({length:200},(_,i)=>({id:String(i),role:'assistant',text:'中'.repeat(120000)})),running:false});const s=await createService(f);t.after(()=>s.close());const read=await s.handle(request('sessions.read',{sessionId:'existing'}));assert.ok(Buffer.byteLength(JSON.stringify(read))<1024*1024);const sent=await s.handle(request('messages.send',{sessionId:'existing',messageId:'__proto__',text:'hello',contexts:[]}));assert.equal(sent.result.status,'accepted');assert.equal(f.prompts,1);
});
test('installed rc.3 projection extracts messages, compact streaming text and pending approval guidance',()=>{
 const records=[{type:'event',event:{seq:1,type:'user/message',data:{content:[{type:'text',text:'question'}]}}},{type:'event',event:{seq:2,type:'assistant/message',data:{message:{content:[{type:'reasoning',text:'private thought'},{type:'text',text:'answer'}]}}}},{type:'event',event:{seq:3,type:'tool/result',data:{message:{content:[{type:'text',text:'done'}]}}}},{type:'event',event:{seq:4,type:'approval/asked',data:{id:'approval1',toolName:'pwsh'}}}];
 const projected=projectHistory(records,{assistantStream:{activeAttempt:{attemptId:'a',stream:[{type:'text-chunks',index:0,texts:['par','tial']}]}}});assert.deepEqual(projected.slice(0,3).map(x=>x.text),['question','answer','done']);assert.ok(projected.some(x=>x.text==='partial'));assert.ok(projected.some(x=>x.role==='system'&&x.text.includes('授权')));assert.ok(projected.every(x=>!x.text.includes('private thought')));
});
test('activation prepares native companion once and reports setup failures without breaking projects',async t=>{
 const f=await fixture(t);let cleanup;let service;let attempts=0;const ctx={effect(fn){cleanup=fn();}};
 await activate(ctx,{stateDirectory:f.stateDirectory},{createAdapter:()=>f.adapter,startIpc:async options=>{service=options.service;return {close:async()=>{}};},nativeHostStatus:async()=>({registered:false}),setupNativeHost:async()=>{attempts++;throw new Error('registration blocked');},resolvedNodePath:async()=>process.execPath});t.after(()=>cleanup());
 assert.equal(attempts,1);const status=await service.handle(request('integration.status'));assert.equal(status.result.components.nativeHost.status,'unknown');assert.equal(status.result.setupError.code,'NATIVE_SETUP_FAILED');assert.ok((await service.handle(request('projects.list'))).result.projects.length>0);
});
import {createRuntimeAdapter} from '../host/runtime-adapter.js';
test('runtime adapter uses rc.3 snapshot follow and preserves project creation boundaries',async()=>{
 let creation;let followed;let aborted=false;const ctx={workspaceRegistry:{list:()=>[{id:'project1',path:'C:/p',title:'Project',sessionIds:['s']}]},sessionController:{create:async value=>{creation=value;return{sessionId:'s'};},list:async()=>({items:[{sessionId:'s',running:true}]}),async *follow(request,signal){followed=request;signal.addEventListener('abort',()=>aborted=true);yield{type:'snapshot',records:[{type:'event',event:{seq:0,type:'user/message',data:{content:[{type:'text',text:'hello'}]}}}],hasMore:false,projections:{values:{}},cursor:0};}}};
 const adapter=createRuntimeAdapter(ctx);assert.equal((await adapter.projects())[0].id,'project1');await adapter.createSession({cwd:'C:/private'});assert.deepEqual(creation,{cwd:'C:/private'});const history=await adapter.readSession('s');assert.equal(history.messages[0].text,'hello');assert.equal(history.running,true);assert.equal(aborted,true);assert.deepEqual(followed,{address:{kind:'session',sessionId:'s'},maxMessages:100,assistantStream:true});adapter.close();
});
