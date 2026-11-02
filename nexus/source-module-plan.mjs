// SPDX-License-Identifier: MIT
const disabledPrefixes=['nvidia-libs/','zluda-libs/','extras/','vklayers/','steam-audio/'];
export function sourceModulePlan(modules,variant){
  if(variant!==undefined&&variant!=='nexus-cachyos')throw Error('Unknown source variant');
  if(!Array.isArray(modules)||new Set(modules.map(x=>x.path)).size!==modules.length)throw Error('Invalid source module inventory');
  const required=[],excluded=[];
  for(const module of modules){
    if(!module||typeof module.path!=='string'||!/^[a-zA-Z0-9_.\/-]+$/.test(module.path)||module.path.split('/').some(x=>!x||x==='.'||x==='..')||!/^[a-f0-9]{40}$/.test(module.commit))throw Error('Unsafe source module input');
    (variant&&disabledPrefixes.some(prefix=>module.path.startsWith(prefix))?excluded:required).push({...module});
  }
  return {required,excluded};
}
