// SPDX-License-Identifier: MIT
// Classification comes from the reviewed build-configuration parity contract,
// which mirrors the pinned official Makefile.in defaults. steam-audio and
// ZLUDA are default-disabled optional namespaces: the default fetch plan skips
// them, but an explicit opt-in still includes them so the upstream ability is
// preserved instead of silently removed. Every other namespace stays required.
import {defaultDisabledNamespacePrefixes,optInFeature} from './build-config-parity.mjs';
export function sourceModulePlan(modules,variant,{enable=[]}={}){
  if(variant!==undefined&&variant!=='nexus-cachyos')throw Error('Unknown source variant');
  if(!Array.isArray(modules)||new Set(modules.map(x=>x.path)).size!==modules.length)throw Error('Invalid source module inventory');
  if(!Array.isArray(enable))throw Error('Invalid optional source feature selection');
  const requested=enable.map(name=>optInFeature(name));
  if(new Set(requested.map(entry=>entry.namespace)).size!==requested.length)throw Error('Duplicate optional source feature');
  if(!variant&&requested.length)throw Error('Optional source features require the CachyOS variant');
  const disabled=new Set(defaultDisabledNamespacePrefixes());
  for(const entry of requested)for(const prefix of entry.paths)disabled.delete(prefix);
  const disabledPrefixes=[...disabled];
  const required=[],excluded=[];
  for(const module of modules){
    if(!module||typeof module.path!=='string'||!/^[a-zA-Z0-9_.\/-]+$/.test(module.path)||module.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^[a-f0-9]{40}$/.test(module.commit))throw Error('Unsafe source module input');
    (variant&&disabledPrefixes.some(prefix=>module.path.startsWith(prefix))?excluded:required).push({...module});
  }
  return {required,excluded,enabledOptional:requested.map(entry=>entry.namespace).sort()};
}
