import {createServer} from 'node:net';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir,writeFile,rename,unlink,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {FrameDecoder,encodeFrame} from '../native/framing.js';
export async function startIpc({service,stateDirectory}) {
 const id=randomUUID();const directory=join(stateDirectory,'instances');await mkdir(directory,{recursive:true,mode:0o700});await chmod(directory,0o700).catch(()=>{});
 const pipe=process.platform==='win32'?`\\\\.\\pipe\\dsh-chrome-${process.pid}-${id}`:join(directory,id+'.sock');const token=randomBytes(32).toString('hex');const tokenBytes=Buffer.from(token);const sockets=new Set();let closed=false;
 const send=(socket,value)=>{if(socket.destroyed)return;try{if(socket.writableLength>2*1024*1024){socket.destroy();return;}socket.write(encodeFrame(value));}catch{socket.destroy();}};
 const server=createServer(socket=>{sockets.add(socket);let authenticated=false;let inflight=0;const timer=setTimeout(()=>socket.destroy(),5000);timer.unref();
 const decoder=new FrameDecoder(value=>{
 if(!authenticated){const candidate=typeof value?.token==='string'?Buffer.from(value.token):Buffer.alloc(0);if(value?.kind!=='authenticate'||candidate.length!==tokenBytes.length||!timingSafeEqual(candidate,tokenBytes)){socket.destroy();return;}authenticated=true;service.connectionState?.(true);clearTimeout(timer);send(socket,{kind:'authenticated'});return;}
 if(++inflight>32){socket.destroy();return;}Promise.resolve(service.handle(value)).then(reply=>send(socket,reply)).catch(()=>socket.destroy()).finally(()=>inflight--);
 });socket.on('data',chunk=>{try{decoder.push(chunk);}catch{socket.destroy();}});socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(timer);sockets.delete(socket);if(authenticated&&!Array.from(sockets).some(s=>s.authenticated()))service.connectionState?.(false);});socket.authenticated=()=>authenticated;
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,()=>{server.off('error',reject);resolve();});});server.on('error',()=>{});
 const record={protocolVersion:1,version:'0.1.0',pid:process.pid,pipe,token,createdAt:new Date().toISOString()};const path=join(directory,id+'.json');const temporary=path+'.tmp';
 try{await writeFile(temporary,JSON.stringify(record),{mode:0o600,flag:'wx'});await rename(temporary,path);await chmod(path,0o600).catch(()=>{});}catch(error){server.close();await unlink(temporary).catch(()=>{});throw error;}
 const unsubscribe=service.subscribe(event=>{for(const socket of sockets)if(socket.authenticated())send(socket,event);});
 return {record,async close(){if(closed)return;closed=true;unsubscribe();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});if(process.platform!=='win32')await unlink(pipe).catch(()=>{});}};
}
