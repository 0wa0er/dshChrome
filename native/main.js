#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { integrationHome } from '../install/registration.js';
import { validateRequest, failure } from '../shared/protocol.js';
import { FrameDecoder, encodeFrame } from './framing.js';
import { connectHost } from './connection.js';
import { nativeOptions } from './options.js';

const release = JSON.parse(await readFile(new URL('../release.json',import.meta.url),'utf8'));
let options;
try {options=nativeOptions(process.argv.slice(2),{defaultDirectory:integrationHome(),extensionId:release.extensionId});}
catch(error) {process.stderr.write(error.message+'\n');process.exit(1);}
let hostPromise, client, closed = false;
const emit = value => {if (!closed) {try {process.stdout.write(encodeFrame(value));} catch { /* Oversized output must not corrupt the native stream. */ process.exitCode=1; shutdown();} }};
async function host() {
  if (!hostPromise) hostPromise = connectHost(options).then(connection => {
    client=connection;
    connection.onMessage(emit);
    connection.onClose(()=>{client=null;hostPromise=null;emit({protocolVersion:1,event:'integration.disconnected',data:{message:'dsh 已关闭或重新启动'}});});
    return connection;
  }).catch(error=>{hostPromise=null;throw error;});
  return hostPromise;
}
function shutdown() {closed=true;client?.close();process.stdin.destroy();}
const decoder = new FrameDecoder(value => {
  Promise.resolve().then(async()=>{
    validateRequest(value);
    const connection = await host();
    if (!closed) connection.send(value);
  }).catch(error=>emit(failure(typeof value?.requestId==='string'?value.requestId:'invalid',error)));
});
process.stdin.on('data',chunk=>{try {decoder.push(chunk);}catch(error){process.stderr.write(`${error.message}\n`);shutdown();process.exitCode=1;}});
process.stdin.on('end',shutdown);
process.stdout.on('error',shutdown);
process.on('SIGTERM',shutdown);
