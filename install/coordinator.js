import { randomUUID } from 'node:crypto';
const targets = ['nativeHost', 'host', 'extension'];
export class InstallationCoordinator {
  constructor({ release, probe = async () => ({}), installNativeHost, openEntry = async () => {}, onProgress = () => {} }) {
    this.release=release; this.probe=probe; this.installNativeHost=installNativeHost; this.open=openEntry; this.onProgress=onProgress; this.operations=new Map();
  }
  async status() {
    const detected=await this.probe();
    const components=Object.fromEntries(targets.map(target=>{
      const item=detected[target];
      return [target, item ? {...item,status:item.protocolVersion !== this.release.protocolVersion || item.version !== this.release.version ? 'incompatible' : (target==='extension' && !item.connected ? 'unknown':'ready')} : {status:'unknown'}];
    }));
    return {state:targets.every(t=>components[t].status==='ready')?'ready':'awaiting-user',version:this.release.version,protocolVersion:this.release.protocolVersion,components};
  }
  validate(params) {
    for(const key of Object.keys(params)) if(!['target','version','operationId','userInitiated'].includes(key)) throw new Error('Unsupported installation parameter');
    if(!targets.includes(params.target)) throw new Error('Unsupported component');
    if(params.userInitiated!==true) throw new Error('Installation requires an explicit user action');
    if(params.version && params.version!==this.release.version) throw new Error('Unsupported release version');
    if(params.operationId!==undefined && (typeof params.operationId!=='string'||!params.operationId||params.operationId.length>128)) throw new Error('Invalid operation ID');
  }
  async ensure(params) {
    this.validate(params);
    const operationId=params.operationId||randomUUID();
    if(this.operations.has(operationId)) {
      const existing=this.operations.get(operationId);
      if(existing.target!==params.target) throw new Error('Operation ID already used for another target');
      return existing.promise;
    }
    const promise=Promise.resolve().then(()=>this.perform({...params,operationId}));
    this.operations.set(operationId,{target:params.target,promise});
    return promise;
  }
  progress(operationId,state,details={}) {const result={operationId,state,...details}; this.onProgress(result); return result;}
  async perform({target,operationId}) {
    try {
      const status=await this.status(); const component=status.components[target];
      if(component.status==='ready') return this.progress(operationId,'ready');
      if(component.status==='incompatible') return this.progress(operationId,'failed',{error:{code:'INCOMPATIBLE_VERSION',message:`${target} ${component.version} / protocol ${component.protocolVersion}; expected ${this.release.version} / protocol ${this.release.protocolVersion}`}});
      if(target==='nativeHost' && this.installNativeHost) {
        this.progress(operationId,'installing'); await this.installNativeHost(); return this.progress(operationId,'ready');
      }
      const entry=await this.openEntry({target,userInitiated:true});
      return this.progress(operationId,'awaiting-user',entry);
    } catch(error) {return this.progress(operationId,'failed',{error:{code:'INSTALLATION_FAILED',message:error.message}});}
  }
  async openEntry(params) {
    this.validate(params);
    const url=params.target==='extension'?this.release.webStoreUrl:this.release.installerUrl;
    if(url) {
      const parsed=new URL(url); if(parsed.protocol!=='https:') throw new Error('Published entry must use HTTPS');
      await this.open(url);
      return {url,instructions:params.target==='extension'?'Confirm installation in Chrome, then return for a connection handshake.':'Download the companion installer and launch it manually. Return here after setup completes.'};
    }
    return {development:true,instructions:params.target==='extension'?'Development installation: open chrome://extensions, enable Developer mode, choose Load unpacked and select this package’s extension directory. Wait for a connection handshake.':'Development installation: install this package through dsh plugin --profile desktop add <tarball>, then run node install/cli.js setup from the installed package. A published companion installer is not available.'};
  }
}
