import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createService} from './service.js';
import {createRuntimeAdapter} from './runtime-adapter.js';
import {startIpc} from './ipc.js';
import {InstallationCoordinator} from '../install/coordinator.js';
import {createRegistrationPlan,setupNativeHost,nativeHostStatus,resolvedNodePath,runCommand} from '../install/registration.js';
export const name='dsh-chrome';
export const inject=['sessionController','workspaceRegistry'];
export async function activate(ctx,config={},dependencies={}) {
 const stateDirectory=resolve(config.stateDirectory||join(process.env.DSH_HOME||join(homedir(),'.dsh'),'chrome'));
 let service;let ipc;let stopped=false;let setup;
 ctx.effect(()=>async()=>{stopped=true;await setup?.catch(()=>{});await ipc?.close();await service?.close();});
 setup=(async()=>{
 const release=JSON.parse(await readFile(new URL('../release.json',import.meta.url),'utf8'));let setupError;let extension;
 const statusProbe=dependencies.nativeHostStatus||nativeHostStatus;
 const installNative=async()=>{const plan=createRegistrationPlan({release,stateDirectory,installDir:join(stateDirectory,'native'),nodePath:await (dependencies.resolvedNodePath||resolvedNodePath)(),nativePath:fileURLToPath(new URL('../native/main.js',import.meta.url))});await (dependencies.setupNativeHost||setupNativeHost)({plan});setupError=undefined;};
 const installation=dependencies.installation||new InstallationCoordinator({release,probe:async()=>{const native=await statusProbe({release,stateDirectory});return {host:{version:release.version,protocolVersion:release.protocolVersion},...(native.registered?{nativeHost:{version:native.version,protocolVersion:native.protocolVersion}}:{}),...(extension?{extension}:{})};},installNativeHost:installNative,openEntry:async url=>{await runCommand('powershell.exe',['-NoProfile','-NonInteractive','-Command','& { param($url) Start-Process -FilePath $url }',url]);},onProgress:data=>service?.publish('installation.progress',data)});
 if(!dependencies.installation){const originalStatus=installation.status.bind(installation);installation.status=async()=>({...await originalStatus(),...(setupError?{setupError}:{})});installation.handshake=async p=>{if(p.protocolVersion!==1||p.extensionVersion!==release.version)throw Object.assign(new Error('Chrome 扩展版本不兼容，请更新配套组件'),{code:'INCOMPATIBLE_VERSION'});extension={version:p.extensionVersion,protocolVersion:p.protocolVersion,connected:true};};installation.connectionState=connected=>{if(extension)extension.connected=connected;};}
 service=await createService({adapter:(dependencies.createAdapter||createRuntimeAdapter)(ctx),stateDirectory,installation});if(stopped)return;
 try{ipc=await (dependencies.startIpc||startIpc)({service,stateDirectory});}catch(error){await service.close();throw error;}
 if(config.autoSetup!==false&&!dependencies.installation){try{const native=await statusProbe({release,stateDirectory});if(!native.registered&&!stopped)await installNative();}catch{setupError={code:'NATIVE_SETUP_FAILED',message:'本机桥接设置未完成，请使用“修复连接”重试。'};}}
 })();
 await setup;
}
export const apply=activate;
export default {name,inject,apply};
