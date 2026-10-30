import {randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {validateRequest,buildPrompt,success,failure,problem,MAX_FRAME_BYTES} from '../shared/protocol.js';
const own=(o,k)=>Object.hasOwn(o,k);
function boundedMessages(messages) {
 let budget=180000;const result=[];
 for(const m of messages.slice(-200).reverse()) {if(budget<=0)break;const text=String(m.text||'').slice(0,Math.min(100000,budget));budget-=text.length;result.push({id:String(m.id).slice(0,200),role:['user','assistant','tool','system'].includes(m.role)?m.role:'system',text});}
 return result.reverse();
}
const dictionary=value=>Object.assign(Object.create(null),value);
export async function createService({adapter,stateDirectory,installation}) {
 await mkdir(stateDirectory,{recursive:true,mode:0o700});
 const statePath=join(stateDirectory,'state.json');let state;
 try {state=JSON.parse(await readFile(statePath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;state={version:1,sessions:{},sends:{}};}
 if(state.version!==1||!state.sessions||!state.sends)throw new Error('Unsupported or damaged Chrome companion state');
 state.sessions=dictionary(state.sessions);state.sends=dictionary(state.sends);for(const key of Object.keys(state.sends))state.sends[key]=dictionary(state.sends[key]);
 let tail=Promise.resolve();let closed=false;const listeners=new Set();const watches=new Map();
 const save=async()=>{const temp=statePath+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(state),{mode:0o600});await rename(temp,statePath);};
 const serial=fn=>{const result=tail.then(fn);tail=result.catch(()=>{});return result;};
 const defaultPath=join(stateDirectory,'default-project');
 const ensureDefault=()=>mkdir(defaultPath,{recursive:true,mode:0o700});await ensureDefault();
 const emit=(event,data)=>{for(const listener of listeners){try{listener({protocolVersion:1,event,data});}catch{}}};
 const projects=async()=>[{id:'default',title:'默认',path:defaultPath,isDefault:true},...(await adapter.projects()).filter(p=>resolve(p.path)!==resolve(defaultPath)).map(p=>({id:p.id,title:p.title,path:p.path,isDefault:false,sessionIds:p.sessionIds||[]}))];
 const project=async id=>{const p=(await projects()).find(p=>p.id===id);if(!p)throw problem('PROJECT_NOT_FOUND','项目已不存在，请重新选择项目');return p;};
 const allSessions=()=>adapter.listSessions();
 const membership=(row,p)=>{if(p.id==='default')return own(state.sessions,row.sessionId)&&state.sessions[row.sessionId].projectId==='default'&&row.cwd&&resolve(row.cwd)===resolve(defaultPath);return p.sessionIds.includes(row.sessionId);};
 const locate=async id=>{const row=(await allSessions()).find(s=>s.sessionId===id);if(!row)throw problem('SESSION_NOT_ALLOWED','会话不属于可访问的项目');const p=(await projects()).find(p=>membership(row,p));if(!p)throw problem('SESSION_NOT_ALLOWED','会话不属于可访问的项目');return {row,p};};
 const sessionRow=(row,p)=>({id:row.sessionId,title:row.projections?.values?.title||'新对话',projectId:p.id});
 const watch=id=>{if(watches.has(id)||!adapter.watchSession)return;watches.set(id,adapter.watchSession(id,()=>emit('session.changed',{sessionId:id})));};
 async function dispatch(method,p) {
 switch(method){
 case 'integration.status':return installation?installation.status():{protocolVersion:1,version:'0.1.0',state:'awaiting-user',components:{host:{status:'ready',version:'0.1.0',protocolVersion:1},extension:{status:'unknown'},nativeHost:{status:'unknown'}}};
 case 'integration.handshake':await installation?.handshake?.(p);if(p.protocolVersion!==undefined&&p.protocolVersion!==1)throw problem('INCOMPATIBLE_PROTOCOL','组件通信版本不兼容');return {protocolVersion:1,version:'0.1.0',capabilities:['projects','sessions','selection-context','cancel'],connected:true};
 case 'installation.ensureCompanion':if(!installation)throw problem('INSTALLATION_UNAVAILABLE','请运行配套安装程序完成设置');return installation.ensure(p);
 case 'installation.openEntry':if(!installation)throw problem('INSTALLATION_UNAVAILABLE','请运行配套安装程序完成设置');return installation.openEntry(p);
 case 'projects.list':return {projects:(await projects()).map(({sessionIds,...p})=>p)};
 case 'sessions.list':{const target=await project(p.projectId);return {sessions:(await allSessions()).filter(row=>membership(row,target)).slice(-500).map(row=>sessionRow(row,target))};}
 case 'sessions.create':{const target=await project(p.projectId);if(target.isDefault)await ensureDefault();const created=await adapter.createSession(target.isDefault?{cwd:defaultPath}:{workspaceId:target.id});state.sessions[created.sessionId]={projectId:target.id};await save();watch(created.sessionId);emit('session.changed',{sessionId:created.sessionId});return {session:{id:created.sessionId,title:'新对话',projectId:target.id}};}
 case 'sessions.read':{const {row,p:target}=await locate(p.sessionId);watch(p.sessionId);const history=await adapter.readSession(p.sessionId);return {session:sessionRow(row,target),...history,messages:boundedMessages(history.messages),truncated:history.messages.length>200||history.messages.reduce((n,m)=>n+String(m.text||'').length,0)>180000};}
 case 'sessions.cancel':await locate(p.sessionId);await adapter.cancel(p.sessionId);emit('session.changed',{sessionId:p.sessionId});return {accepted:true};
 case 'messages.status':await locate(p.sessionId);return {messageId:p.messageId,status:state.sends[p.sessionId]?.[p.messageId]?.status==='accepted'?'accepted':'unknown'};
 case 'messages.send':{await locate(p.sessionId);const previous=own(state.sends[p.sessionId]||{},p.messageId)?state.sends[p.sessionId][p.messageId]:undefined;if(previous){if(previous.status==='accepted')return {messageId:p.messageId,status:'accepted'};throw problem('SEND_UNCERTAIN','上次发送结果未确认，请检查会话记录；不会自动重复发送');}
 const runtimeRequestId=randomUUID();state.sends[p.sessionId]??=Object.create(null);state.sends[p.sessionId][p.messageId]={status:'unknown',runtimeRequestId};await save();watch(p.sessionId);
 try{await adapter.prompt({requestId:runtimeRequestId,sessionId:p.sessionId,mode:'queue',content:[{type:'text',text:buildPrompt(p.text,p.contexts)}]});state.sends[p.sessionId][p.messageId].status='accepted';await save();}catch{throw problem('SEND_UNCERTAIN','发送结果未确认，请检查会话记录；不会自动重复发送');}
 emit('session.changed',{sessionId:p.sessionId});return {messageId:p.messageId,status:'accepted'};}
 }
 }
 return {publish:emit,connectionState:connected=>installation?.connectionState?.(connected),subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},handle(request){return serial(async()=>{try{if(closed)throw problem('HOST_CLOSED','宿主连接已关闭');if(Buffer.byteLength(JSON.stringify(request))>MAX_FRAME_BYTES)throw problem('INVALID_REQUEST','请求过大');validateRequest(request);return success(request.requestId,await dispatch(request.method,request.params));}catch(error){return failure(typeof request?.requestId==='string'?request.requestId:'',error);}});},async close(){closed=true;await tail;for(const dispose of watches.values())dispose?.();watches.clear();listeners.clear();await adapter.close?.();}};
}
