import net from 'node:net';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { FrameDecoder, encodeFrame } from './framing.js';

export async function connectHost({stateDirectory, timeout = 4000}) {
  let files;
  try { files = await readdir(path.join(stateDirectory,'instances')); } catch { files=[]; }
  const records = [];
  for (const name of files.filter(n => /^[\w-]+\.json$/.test(n)).slice(0,100)) {
    try {
      const record = JSON.parse(await readFile(path.join(stateDirectory,'instances',name),'utf8'));
      if (record.protocolVersion !== 1 || typeof record.token !== 'string' || typeof record.pipe !== 'string' || !Number.isSafeInteger(record.pid)) continue;
      if (process.platform === 'win32' && !record.pipe.startsWith('\\\\.\\pipe\\dsh-chrome-')) continue;
      if (process.platform !== 'win32' && !record.pipe.startsWith(stateDirectory+path.sep)) continue;
      try { process.kill(record.pid,0); } catch { continue; }
      records.push(record);
    } catch { /* An unfinished or removed record is not an active instance. */ }
  }
  const timestamp = value => typeof value === 'number' ? value : Date.parse(value) || 0;
  records.sort((a,b)=>timestamp(b.createdAt)-timestamp(a.createdAt));
  for (const record of records) {
    try { return await connectRecord(record,timeout); } catch { /* Try the next known local instance, never arbitrary ports. */ }
  }
  throw new Error('未连接到 dsh Chrome 宿主插件。请安装配套插件并重新启动 dsh 桌面版。');
}

function connectRecord(record,timeout) {
  return new Promise((resolve,reject) => {
    const socket = net.createConnection(record.pipe);
    const listeners = new Set(), closeListeners = new Set();
    let authenticated = false;
    const timer = setTimeout(()=>{ socket.destroy();reject(new Error('dsh 配对超时')); },timeout);
    const decoder = new FrameDecoder(msg => {
      if (!authenticated) {
        if (msg.kind !== 'authenticated') { socket.destroy();reject(new Error('dsh 配对失败'));return; }
        authenticated=true;clearTimeout(timer);
        resolve({
          send(value) { if (socket.destroyed) throw new Error('dsh 连接已断开');socket.write(encodeFrame(value)); },
          onMessage(listener) {listeners.add(listener);return ()=>listeners.delete(listener);},
          onClose(listener) {closeListeners.add(listener);return ()=>closeListeners.delete(listener);},
          close() {socket.destroy();},
        });
      } else for (const listener of listeners) listener(msg);
    });
    socket.on('connect',()=>socket.write(encodeFrame({kind:'authenticate',token:record.token})));
    socket.on('data',chunk=>{try {decoder.push(chunk);} catch(error) {socket.destroy(error);} });
    socket.on('error',error=>{clearTimeout(timer);if(!authenticated) reject(error);});
    socket.on('close',()=>{clearTimeout(timer);if(!authenticated)reject(new Error('dsh 连接关闭'));for(const listener of closeListeners) listener();});
  });
}
