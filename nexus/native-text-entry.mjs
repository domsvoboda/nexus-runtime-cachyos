// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {peMachine} from './pe.mjs';

// An unreasonable component is rejected, but the bound must fit real builds:
// SDK #59 produces a 2,674,278-byte x86_64 and a 2,598,916-byte i386 bridge.
const maxBridgeBytes=4*1024*1024;

// Older pinned components without the optional helper remain unchanged. A
// component that supplies Python must also supply its matching PE bridge.
export async function stageNativeTextEntry(files, target) {
  if(!['x86_64','i386','aarch64'].includes(target.primaryPe)||!/^default_pfx(?:_[a-z0-9_]+)?$/.test(target.prefix))
    throw new Error('Invalid native text-entry staging target');
  // The CachyOS variant enables this host GTK helper for its x86_64 target
  // only; ARM64 stays off until it has a reviewed build and game validation.
  if(target.primaryPe!=='x86_64')return null;
  const moduleDirectory=path.join(files,'lib/wine',`${target.primaryPe}-windows`);
  let content;
  try { content=await fs.readFile(path.join(moduleDirectory,'nexus-text-entry.py')); }
  catch(error) { if(error.code==='ENOENT')return null;throw error; }
  if(!content.length||content.length>256*1024)throw new Error('Invalid native text-entry helper size');
  const targets=[{architecture:target.primaryPe,directory:'system32'}];
  if(target.primaryPe!=='i386'&&target.peArchitectures?.includes('i386'))
    targets.push({architecture:'i386',directory:'syswow64'});
  // Validate the whole component pair before writing prefix files.
  const bridges=[];
  for(const item of targets){
    const bridge=await fs.readFile(path.join(files,'lib/wine',`${item.architecture}-windows`,'nexus-text-entry-host.exe'));
    if(bridge.length>maxBridgeBytes||peMachine(bridge)!==item.architecture)throw new Error('Invalid native text-entry bridge size or architecture');
    bridges.push({...item,bridge});
  }
  const bridgeSha256={};
  for(const item of bridges){
    const directory=path.join(files,'share',target.prefix,'drive_c/windows',item.directory);
    await fs.mkdir(directory,{recursive:true});
    for(const [name,bytes]of [['nexus-text-entry.py',content],['nexus-text-entry-host.exe',item.bridge]]){
      const destination=path.join(directory,name),temporary=destination+'.nexus-runtime';
      await fs.writeFile(temporary,bytes,{flag:'wx',mode:0o644});
      await fs.rename(temporary,destination);
    }
    bridgeSha256[item.architecture]=createHash('sha256').update(item.bridge).digest('hex');
  }
  return {sha256:createHash('sha256').update(content).digest('hex'),bridgeSha256,protocol:'native-text-entry-v4',
    hostRequirements:['python3','PyGObject','GTK4'],gameplayValidated:false};
}
