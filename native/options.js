import path from 'node:path';
export function nativeOptions(args,{defaultDirectory,extensionId}) {
  let stateDirectory=defaultDirectory;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--state-directory') {
      if(!args[i+1]||!path.isAbsolute(args[i+1]))throw new Error('Invalid native state directory argument');
      stateDirectory=path.resolve(args[++i]);
    } else if(args[i].startsWith('chrome-extension://')) {
      if(args[i]!==`chrome-extension://${extensionId}/`)throw new Error('Unexpected Chrome extension origin');
    } else if(args[i].startsWith('--parent-window=')) {
      if(!/^--parent-window=\d+$/.test(args[i]))throw new Error('Invalid parent window argument');
    } else throw new Error('Unexpected native launch argument');
  }
  return {stateDirectory};
}
