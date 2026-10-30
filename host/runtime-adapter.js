// Installed rc.3 derives user/message directly from data; assistant/message and tool/result use data.message.
// See dsh-session/lib/index.js deriveEventMessage; streaming chunks are text-delta/block-end.
const MAX_TEXT=120_000;
const textOf=content=>typeof content==='string'?content:(Array.isArray(content)?content.filter(p=>p?.type==='text').map(p=>p.text||'').join('\n'):'');
export function projectHistory(records,{assistantStream,projections}={}) {
 const messages=[];const approvals=new Set();
 for(const record of records){const e=record.event;if(!e)continue;if(e.type==='approval/asked')approvals.add(e.data?.id);if(e.type==='approval/decided')approvals.delete(e.data?.id);let message;let role;
 if(e.type==='user/message'){message=e.data;role='user';}
 else if(e.type==='assistant/message'){message=e.data?.message;role='assistant';}
 else if(e.type==='tool/result'){message=e.data?.message;role='tool';}
 if(message){const text=textOf(message.content).slice(0,MAX_TEXT);if(text)messages.push({id:String(e.seq),role,text});}
 else if(e.type==='tool/call')messages.push({id:String(e.seq),role:'tool',text:'正在使用工具。需要授权或查看工具详情时，请在 DeepSeek Harness 中打开此会话。'});
 }
 const attempt=assistantStream?.activeAttempt;
 if(attempt){const blocks=new Map();for(const record of attempt.stream||[]){if(record.type==='text-chunks')blocks.set(record.index,(blocks.get(record.index)||'')+record.texts.join(''));else if(record.type==='chunk'){const c=record.chunk;if(c.type==='text-delta')blocks.set(c.index,(blocks.get(c.index)||'')+c.text);if(c.type==='block-end'&&c.block?.type==='text')blocks.set(c.index,c.block.text);}}
 const text=[...blocks.values()].join('\n').slice(0,MAX_TEXT);if(text)messages.push({id:'stream:'+attempt.attemptId,role:'assistant',text});}
 const values=projections?.values||{};
 if(values.userQuestions?.active?.length||approvals.size)messages.push({id:'action-required',role:'system',text:'此会话需要你的授权或回答。请在 DeepSeek Harness 中打开会话并处理，然后返回继续。'});
 return messages.slice(-200);
}
export function createRuntimeAdapter(ctx){
 const controller=ctx.sessionController;const lifetimes=new Set();
 const makeController=()=>{const c=new AbortController();lifetimes.add(c);return c;};
 async function snapshot(sessionId){const lifetime=makeController();const stream=controller.follow({address:{kind:'session',sessionId},maxMessages:100,assistantStream:true},lifetime.signal);const iterator=stream[Symbol.asyncIterator]();try{const {value,done}=await iterator.next();if(done||value.type!=='snapshot')throw new Error('Session history snapshot unavailable');return value;}finally{lifetime.abort();lifetimes.delete(lifetime);await iterator.return?.();}}
 return {
 async projects(){return ctx.workspaceRegistry.list().map(p=>({id:p.id,path:p.path,title:p.title,sessionIds:[...p.sessionIds]}));},
 async listSessions(){const c=makeController();try{return (await controller.list({},c.signal)).items;}finally{lifetimes.delete(c);}},
 createSession:options=>controller.create(options),
 async readSession(id){const frame=await snapshot(id);const summary=(await this.listSessions()).find(s=>s.sessionId===id);return {messages:projectHistory(frame.records,frame),running:summary?.running===true,hasMore:frame.hasMore};},
 async prompt(request){const c=makeController();try{return await controller.prompt(request,c.signal);}finally{lifetimes.delete(c);}},
 cancel:id=>controller.cancel({sessionId:id}),
 watchSession(id,listener){const c=makeController();(async()=>{try{for await(const frame of controller.follow({address:{kind:'session',sessionId:id},maxMessages:1,assistantStream:true},c.signal)){if(frame.type!=='snapshot')listener();}}catch(error){if(!c.signal.aborted)listener({error:'连接中断，请重新打开会话'});}finally{lifetimes.delete(c);}})();return()=>{c.abort();lifetimes.delete(c);};},
 close(){for(const c of lifetimes)c.abort();lifetimes.clear();}
 };
}
