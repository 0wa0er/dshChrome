import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallationCoordinator } from '../install/coordinator.js';
import { createRegistrationPlan, setupNativeHost, unregisterNativeHost } from '../install/registration.js';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const release = {version:'0.1.0',protocolVersion:1,extensionId:'a'.repeat(32),webStoreUrl:null,installerUrl:null};
test('unknown counterpart remains awaiting user until actual compatible handshake', async () => {
 const c = new InstallationCoordinator({release, probe:async()=>({nativeHost:{version:'0.1.0',protocolVersion:1},extension:null})});
 const s=await c.status(); assert.equal(s.components.extension.status,'unknown');
 const r=await c.ensure({target:'extension',userInitiated:true}); assert.equal(r.state,'awaiting-user'); assert.match(r.instructions,/chrome:\/\/extensions/);
});
test('bootstrap only opens configured installer and never request URLs', async () => {
 const opened=[]; const c=new InstallationCoordinator({release:{...release,installerUrl:'https://example.org/setup.zip'},probe:async()=>({}),openEntry:async u=>opened.push(u)});
 await assert.rejects(c.ensure({target:'host',userInitiated:true,url:'https://evil.org'}),/unsupported/i);
 const r=await c.ensure({target:'host',userInitiated:true}); assert.equal(r.state,'awaiting-user'); assert.deepEqual(opened,['https://example.org/setup.zip']);
});
test('duplicate operation shares installation and emits stable progress identity', async () => {
 let count=0; const events=[]; const c=new InstallationCoordinator({release,probe:async()=>({}),installNativeHost:async()=>{count++;},onProgress:e=>events.push(e)});
 const input={target:'nativeHost',operationId:'once',userInitiated:true};
 const [a,b]=await Promise.all([c.ensure(input),c.ensure(input)]); assert.deepEqual(a,b); assert.equal(count,1); assert.ok(events.every(e=>e.operationId==='once')); assert.equal(a.state,'ready');
});
test('incompatible actual component fails and ordinary requests cannot install',async()=>{
 const c=new InstallationCoordinator({release,probe:async()=>({extension:{version:'9.0',protocolVersion:9,connected:true}})});
 assert.equal((await c.ensure({target:'extension',userInitiated:true})).state,'failed');
 await assert.rejects(c.ensure({target:'host'}),/user/i);
});
test('registration uses current user allowlist and pinned quoted launcher; dry run changes no registry',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-install-'));
 try {
 const plan=createRegistrationPlan({release,installDir:dir,nodePath:'C:\\Program Files\\nodejs\\node.exe',nativePath:'D:\\Code & stuff\\native\\main.js'});
 assert.equal(plan.manifest.allowed_origins[0],`chrome-extension://${release.extensionId}/`); assert.match(plan.registryKey,/^HKCU\\/);
 assert.match(plan.launcher,/'|"C:\\Program Files\\nodejs\\node.exe"/); assert.match(plan.launcher,/"D:\\Code & stuff\\native\\main.js"/);
 const calls=[]; await setupNativeHost({plan,run:async(...a)=>calls.push(a)}); assert.equal(JSON.parse(await readFile(plan.manifestPath,'utf8')).name,'com.deepseek.dsh_chrome'); assert.equal(calls[0][0],'reg.exe');
 await unregisterNativeHost({run:async(...a)=>calls.push(a)}); assert.deepEqual(calls[1][1].slice(0,2),['delete',plan.registryKey]);
 assert.throws(()=>createRegistrationPlan({release,installDir:dir,nodePath:'C:\\bad%PATH%.exe',nativePath:'D:\\x.js'}),/unsafe/i);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('CLI setup dry run prepares the exact plan without registering and unregister preserves files',async()=>{
 const {runCli}=await import('../install/cli.js');
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-cli-'));
 try {const r=await runCli(['setup','--dry-run'],{installDir:dir});assert.equal(r.registryKey,`HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.deepseek.dsh_chrome`); assert.equal(r.manifest.allowed_origins[0],'chrome-extension://hnlecbcnoomfbcifohincedegbhmiked/');}finally{await rm(dir,{recursive:true,force:true});}
});

test('desktop executable launcher runs in Node mode and status rejects stale registry entries',async()=>{
 const {nativeHostStatus}=await import('../install/registration.js');
 const plan=createRegistrationPlan({release,installDir:os.tmpdir(),nodePath:'C:\\Apps\\DeepSeek Harness.exe',nativePath:'D:\\plugin\\native\\main.js'});
 assert.match(plan.launcher,/set "ELECTRON_RUN_AS_NODE=1"/);
 const state=await nativeHostStatus({release,run:async()=>({stdout:'    (Default)    REG_SZ    C:\\missing-manifest.json\r\n'})});
 assert.equal(state.registered,false);assert.equal(state.reason,'invalid-registration');
});

test('registration status verifies existing matching files and rejects version drift',async()=>{
 const {nativeHostStatus}=await import('../install/registration.js');
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-status-'));
 try {
 const plan=createRegistrationPlan({release,installDir:dir,nodePath:process.execPath,nativePath:'D:\\plugin\\native\\main.js'});
 await setupNativeHost({plan,run:async()=>{}});
 const run=async()=>({stdout:`    (Default)    REG_SZ    ${plan.manifestPath}\r\n`});
 assert.equal((await nativeHostStatus({run,release})).registered,true);
 assert.equal((await nativeHostStatus({run,release:{...release,version:'2'}})).registered,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('Windows bootstrap dry run plans supported desktop carrier and companion registration without launching',async()=>{
 const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util');
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-bootstrap-')); const tgz=path.join(dir,'package.tgz');
 try {
 const {writeFile}=await import('node:fs/promises');await writeFile(tgz,'dry run fixture');
 const r=await promisify(execFile)('powershell.exe',['-NoProfile','-File',path.resolve('install/windows-install.ps1'),'-Tarball',tgz,'-DesktopDirectory',dir,'-DryRun']);
 const plan=JSON.parse(r.stdout);assert.ok(plan.cli.endsWith('dsh-desktop-host\\lib\\cli.js'));assert.deepEqual(plan.installArguments,['plugin','--profile','desktop','add',tgz]);assert.ok(plan.setup.endsWith('install\\cli.js'));assert.equal(plan.state,'awaiting-user');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('launcher pins configured discovery directory without forwarding browser arguments',()=>{
 const stateDirectory='D:\\Custom state & data\\chrome';
 const plan=createRegistrationPlan({release,installDir:os.tmpdir(),nodePath:process.execPath,nativePath:'D:\\plugin\\native\\main.js',stateDirectory});
 assert.ok(plan.launcher.includes(`--state-directory "${stateDirectory}"`));
 assert.equal(plan.launcher.includes('%*'),false);
 assert.throws(()=>createRegistrationPlan({release,installDir:os.tmpdir(),nodePath:process.execPath,nativePath:'D:\\plugin\\native\\main.js',stateDirectory:'D:\\bad%PATH%\\chrome'}),/unsafe/i);
});

test('registration status rejects a launcher pinned to a previous state directory',async()=>{
 const {nativeHostStatus}=await import('../install/registration.js');
 const dir=await mkdtemp(path.join(os.tmpdir(),'dsh-state-status-'));
 try {
 const stateDirectory='D:\\state\\current';
 const plan=createRegistrationPlan({release,installDir:dir,nodePath:process.execPath,nativePath:'D:\\plugin\\native\\main.js',stateDirectory});
 await setupNativeHost({plan,run:async()=>{}});
 const run=async()=>({stdout:`    (Default)    REG_SZ    ${plan.manifestPath}\r\n`});
 assert.equal((await nativeHostStatus({run,release,stateDirectory})).registered,true);
 assert.equal((await nativeHostStatus({run,release,stateDirectory:'D:\\state\\new'})).registered,false);
 } finally {await rm(dir,{recursive:true,force:true});}
});
