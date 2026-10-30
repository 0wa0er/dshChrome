// Read-only against the installed application. Plugin installation writes only
// an isolated test DSH_HOME under this checkout, never the user's real profile.
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(import.meta.dirname,'..');
const directory=path.join(root,'.test-output','installed-runtime');
await mkdir(directory,{recursive:true});
const desktop=process.argv[2] || path.join(process.env.LOCALAPPDATA||path.join(process.env.USERPROFILE,'AppData','Local'),'Programs','DeepSeek Harness');
const executable=path.join(desktop,'DeepSeek Harness.exe');await access(executable);
const runtime=path.join(desktop,'resources','app.asar','dsh');
const reportPath=path.join(directory,'exports.json');
const smokePath=path.join(directory,'exports-smoke.mjs');
await writeFile(smokePath,`
import {writeFile} from 'node:fs/promises';
const paths=${JSON.stringify({session:pathToFileURL(path.join(runtime,'node_modules','@deepseek-ai','dsh-api-session-controller','lib','index.js')).href,workspace:pathToFileURL(path.join(runtime,'node_modules','@deepseek-ai','dsh-workspace','lib','index.js')).href})};
const report={};
try {
 for (const [name,url] of Object.entries(paths)) {const mod=await import(url);const Constructor=mod[name==='session'?'SessionController':'WorkspaceRegistry'];report[name]=Object.getOwnPropertyNames(Constructor.prototype);}
 const plugin=await import(${JSON.stringify(pathToFileURL(path.join(root,'host','index.js')).href)});
 report.plugin={name:plugin.name,inject:plugin.inject,apply:typeof plugin.apply};
 await writeFile(${JSON.stringify(reportPath)},JSON.stringify(report,null,2));
} catch(e) {await writeFile(${JSON.stringify(reportPath)},JSON.stringify({error:e.stack}));process.exitCode=1;}
`);
async function run(args,env={}) {
  return await new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe'],cwd:directory,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',...env}});
    let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.on('error',reject);
    const timer=setTimeout(()=>{child.kill();reject(Error('Installed runtime command timed out'));},60000);
    child.on('exit',code=>{clearTimeout(timer);resolve({code,output});});
  });
}
const smoke=await run(['--expose-internals',smokePath]);
const exports=JSON.parse(await readFile(reportPath,'utf8'));
if(smoke.code!==0||exports.error)throw Error(exports.error||smoke.output||'Installed export validation failed');
for(const method of ['create','list','prompt','cancel','follow'])if(!exports.session.includes(method))throw Error('Missing session method '+method);
const profileHome=path.join(directory,'isolated-home');
const profileDirectory=path.join(profileHome,'profiles','desktop');
await mkdir(profileDirectory,{recursive:true});
// The desktop carrier intentionally refuses to initialize its own profile.
// Seed only a fresh test manifest, with the same shipped bundle declarations.
try { await access(path.join(profileDirectory,'package.json')); } catch {
  await writeFile(path.join(profileDirectory,'package.json'),JSON.stringify({name:'dsh-profile-desktop',private:true,dependencies:{},dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app']}}},null,2));
}
const cli=path.join(runtime,'node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');
const install=await run(['--expose-internals',cli,'plugin','--profile','desktop','add',path.join(root,'dist','dsh-chrome-0.1.0.tgz')],{DSH_HOME:profileHome});
await writeFile(path.join(directory,'install-output.txt'),install.output);
let profile;try {profile=JSON.parse(await readFile(path.join(profileHome,'profiles','desktop','package.json'),'utf8'));} catch {throw Error('Isolated desktop profile was not created: '+install.output);}
const active=profile.dsh?.profile?.bundles?.includes('dsh-chrome')===true;
const report={exports,installation:{exitCode:install.code,dependency:profile.dependencies?.['dsh-chrome'],bundleActive:active},scope:'Isolated test profile; real running desktop profile unchanged'};
await writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(install.code!==0||!active)process.exitCode=1;
