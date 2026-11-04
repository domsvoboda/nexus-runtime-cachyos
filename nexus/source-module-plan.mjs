// SPDX-License-Identifier: MIT
// Classification comes from the pinned Makefile.in variable assignments, not
// from the ifneq guards alone. The pinned upstream enables extras, nvidia-libs
// and vklayers by default: their guards compare an unset WITHOUT_* value, and no
// default assignment disables them. steam-audio (WITHOUT_STEAM_AUDIO := 1) and
// zluda-libs (WITHOUT_ZLUDA_LIBS ?= 1) are disabled by the pinned defaults, so
// the Nexus variant keeps exactly those two namespaces excluded and the rest
// required. Removing a configure opt-out cannot enable ZLUDA, its default is 1.
const disabledPrefixes=['steam-audio/','zluda-libs/'];
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
