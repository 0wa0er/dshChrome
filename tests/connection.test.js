import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectHost } from '../native/connection.js';
import { FrameDecoder, encodeFrame } from '../native/framing.js';

test('native client discovers a real local pipe, authenticates and forwards requests', async t => {
  const home = await mkdtemp(path.join(os.tmpdir(),'dsh-chrome-'));
  t.after(()=>rm(home,{recursive:true,force:true}));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-chrome-test-${randomUUID()}` : path.join(home,'test.sock');
  const server = net.createServer(socket => {
    let authenticated = false;
    const decoder = new FrameDecoder(msg => {
      if (!authenticated) { assert.equal(msg.token,'test-token'); authenticated=true;socket.write(encodeFrame({kind:'authenticated'})); }
      else socket.write(encodeFrame({protocolVersion:1,requestId:msg.requestId,result:{ok:true}}));
    });
    socket.on('data',chunk=>decoder.push(chunk));
  });
  await new Promise(resolve=>server.listen(pipe,resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  await mkdir(path.join(home,'instances'));
  await writeFile(path.join(home,'instances','test.json'),JSON.stringify({protocolVersion:1,pid:process.pid,pipe,token:'test-token',createdAt:Date.now()}));
  const client = await connectHost({stateDirectory:home}); t.after(()=>client.close());
  const result = await new Promise(resolve => { client.onMessage(resolve);client.send({protocolVersion:1,requestId:'r1',method:'projects.list',params:{}}); });
  assert.deepEqual(result.result,{ok:true});
  client.close();
});
test('missing discovery returns actionable install/restart error', async t => {
  const home=await mkdtemp(path.join(os.tmpdir(),'dsh-chrome-empty-'));t.after(()=>rm(home,{recursive:true,force:true}));
  await assert.rejects(connectHost({stateDirectory:home}),/dsh|插件|启动/i);
});
