import { mkdir, writeFile, realpath, readFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
const exec=promisify(execFile);
export const HOST_NAME='com.deepseek.dsh_chrome';
export const REGISTRY_KEY=`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
export const runCommand=(file,args)=>exec(file,args,{windowsHide:true});
export const integrationHome=()=>path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),'chrome');
function quoteBatch(value) {
 if(typeof value!=='string'||/["%\r\n\x00]/.test(value)||!path.win32.isAbsolute(value)) throw new Error('Unsafe native launcher path');
 return `"${value}"`;
}
export function createRegistrationPlan({release,stateDirectory=integrationHome(),installDir=path.join(stateDirectory,'native'),nodePath=process.execPath,nativePath}) {
 if(!/^[a-p]{32}$/.test(release.extensionId)) throw new Error('Invalid stable Chrome extension ID');
 const launcher=`@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n${quoteBatch(nodePath)} ${quoteBatch(nativePath)} --state-directory ${quoteBatch(stateDirectory)}\r\n`;
 const manifestPath=path.join(installDir,`${HOST_NAME}.json`);
 return {version:release.version,protocolVersion:release.protocolVersion,registryKey:REGISTRY_KEY,manifestPath,launcherPath:path.join(installDir,'launch.cmd'),launcher,manifest:{name:HOST_NAME,description:'DeepSeek Harness Chrome bridge',path:path.join(installDir,'launch.cmd'),type:'stdio',allowed_origins:[`chrome-extension://${release.extensionId}/`]}};
}
export async function setupNativeHost({plan,run=runCommand,dryRun=false}) {
 if(dryRun) return plan;
 await mkdir(path.dirname(plan.manifestPath),{recursive:true});
 await writeFile(plan.launcherPath,plan.launcher,'utf8');
 await writeFile(plan.manifestPath,JSON.stringify({...plan.manifest,version:plan.version,protocolVersion:plan.protocolVersion},null,2),'utf8');
 await run('reg.exe',['add',plan.registryKey,'/ve','/t','REG_SZ','/d',plan.manifestPath,'/f']); return plan;
}
export async function unregisterNativeHost({run=runCommand,dryRun=false}={}) {
 if(!dryRun) await run('reg.exe',['delete',REGISTRY_KEY,'/f']);
 return {registryKey:REGISTRY_KEY,userDataPreserved:true};
}
export async function nativeHostStatus({run=runCommand,release}={}) {
 let result;
 try {result=await run('reg.exe',['query',REGISTRY_KEY,'/ve']);} catch {return {registered:false,reason:'not-registered'};}
 try {
  const manifestPath=result.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1].trim();
  if(!manifestPath) throw new Error('Missing manifest path');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(manifest.name!==HOST_NAME||manifest.type!=='stdio')throw new Error('Invalid manifest');
  await access(manifest.path);
  if(release&&(manifest.version!==release.version||manifest.protocolVersion!==release.protocolVersion||JSON.stringify(manifest.allowed_origins)!==JSON.stringify([`chrome-extension://${release.extensionId}/`])))throw new Error('Incompatible registration');
  return {registered:true,manifestPath,version:manifest.version,protocolVersion:manifest.protocolVersion};
 } catch {return {registered:false,reason:'invalid-registration'};}
}
export async function resolvedNodePath(){return realpath(process.execPath);}


