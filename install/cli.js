#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { InstallationCoordinator } from './coordinator.js';
import { createRegistrationPlan, setupNativeHost, unregisterNativeHost, nativeHostStatus, runCommand, resolvedNodePath } from './registration.js';
const packageRoot=fileURLToPath(new URL('../',import.meta.url));
export async function runCli(args,{installDir,run=runCommand,platform=process.platform}={}) {
 const [command,...flags]=args;
 if(flags.some(f=>f!=='--dry-run')) throw new Error('Unsupported option');
 const dryRun=flags.includes('--dry-run');
 const release=JSON.parse(await readFile(new URL('../release.json',import.meta.url),'utf8'));
 if(!['setup','status','extension','unregister'].includes(command)) throw new Error('Usage: node install/cli.js setup|status|extension|unregister [--dry-run]');
 if(command==='extension') {
   const coordinator=new InstallationCoordinator({release,openEntry:async url=>{
     if(dryRun)return;
     if(platform!=='win32') throw new Error('This installer supports Windows only');
     // PowerShell receives the package-owned URL as a positional value, never as program text.
     await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','& { param($url) Start-Process -FilePath $url }',url]);
   }});
   return coordinator.openEntry({target:'extension',userInitiated:true});
 }
 if(platform!=='win32'&&!dryRun)throw new Error('Native host registration supports Windows only');
 if(command==='status')return {...await nativeHostStatus({run,release}),extension:'unknown',host:'unknown',release};
 if(command==='unregister')return unregisterNativeHost({run,dryRun});
 const plan=createRegistrationPlan({release,installDir,nodePath:await resolvedNodePath(),nativePath:path.join(packageRoot,'native','main.js')});
 await setupNativeHost({plan,run,dryRun});
 return dryRun?plan:{state:'awaiting-user',nativeHostRegistered:true,instructions:'Restart the existing dsh desktop profile to load the installed plugin, then load or open the Chrome extension and verify its connection handshake.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 runCli(process.argv.slice(2)).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
}

