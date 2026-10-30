import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '../host/service.js';
import { startIpc } from '../host/ipc.js';
import { FrameDecoder, encodeFrame } from '../native/framing.js';

test('Chrome native process -> real IPC -> host preserves citations and admits duplicate send only once', async t => {
  const home = await mkdtemp(path.join(process.cwd(),'.integration-test-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const sessions=[], prompts=[];
  const service=await createService({stateDirectory:path.join(home,'chrome'),adapter:{
    async projects(){return [];},async listSessions(){return sessions;},
    async createSession(options){const row={sessionId:'session-test',cwd:options.cwd};sessions.push(row);return row;},
    async readSession(){return {messages:[],running:false};},
    async prompt(message){prompts.push(message);},async cancel(){},
    watchSession(){return ()=>{};},
  }});
  const ipc=await startIpc({service,stateDirectory:path.join(home,'chrome')});
  t.after(async()=>{await ipc.close();await service.close();});
  const child=spawn(process.execPath,['native/main.js','chrome-extension://hnlecbcnoomfbcifohincedegbhmiked/'],{cwd:process.cwd(),env:{...process.env,DSH_HOME:home},stdio:['pipe','pipe','pipe'],windowsHide:true});
  t.after(()=>child.kill());let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
  const pending=new Map();
  const decoder=new FrameDecoder(msg=>{if(msg.requestId&&pending.has(msg.requestId)){pending.get(msg.requestId)(msg);pending.delete(msg.requestId);}});
  child.stdout.on('data',chunk=>decoder.push(chunk));
  let n=0;
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{
    const id='r'+(++n),timer=setTimeout(()=>reject(Error('No native response: '+stderr)),4000);
    pending.set(id,msg=>{clearTimeout(timer);msg.error?reject(Error(msg.error.message)):resolve(msg.result);});
    child.stdin.write(encodeFrame({protocolVersion:1,requestId:id,method,params}));
  });
  assert.equal((await rpc('integration.handshake',{protocolVersion:1,extensionVersion:'0.1.0'})).connected,true);
  const {session}=await rpc('sessions.create',{projectId:'default'});
  const payload={sessionId:session.id,messageId:'one',text:'请解释',contexts:[{id:'ctx',text:'网页选中文字',title:'Example',url:'https://example.com/',capturedAt:Date.now()}]};
  assert.equal((await rpc('messages.send',payload)).status,'accepted');
  assert.equal((await rpc('messages.send',payload)).status,'accepted');
  assert.equal(prompts.length,1);
  assert.match(prompts[0].content[0].text,/网页选中文字/);
  assert.match(prompts[0].content[0].text,/https:\/\/example.com\//);
  assert.equal((await rpc('sessions.list',{projectId:'default'})).sessions.length,1);
  assert.equal(stderr,'');
  child.stdin.end();await new Promise(resolve=>child.on('exit',resolve));
});
