// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {repository} from './inputs.mjs';
import {sourceModulePlan} from './source-module-plan.mjs';
const pin='a'.repeat(40);
test('variant keeps the upstream-enabled namespaces and excludes only the default-disabled ones',()=>{
 const modules=['wine','dxvk','gstreamer','extras/dxvk-sarek','zluda-libs/rocm-systems','nvidia-libs/nvcuda','vklayers/vkbasalt','steam-audio/steam-audio','extras-other'].map(path=>({path,commit:pin}));
 const {required,excluded}=sourceModulePlan(modules,'nexus-cachyos');
 assert.deepEqual(required.map(x=>x.path),['wine','dxvk','gstreamer','extras/dxvk-sarek','nvidia-libs/nvcuda','vklayers/vkbasalt','extras-other']);
 assert.deepEqual(excluded.map(x=>x.path),['zluda-libs/rocm-systems','steam-audio/steam-audio']);
 assert.ok(excluded.every(x=>x.commit===pin));
 // The default (undefined variant) behaviour is unchanged: every module remains required.
 assert.equal(sourceModulePlan(modules).required.length,modules.length);
 assert.equal(sourceModulePlan(modules).excluded.length,0);
});
test('source module planning rejects alias traversal, duplicate paths and mutable pins',()=>{
 for(const modules of [[{path:'../wine',commit:pin}],[{path:'wine',commit:'main'}],[{path:'wine',commit:pin},{path:'wine',commit:pin}]])assert.throws(()=>sourceModulePlan(modules,'nexus-cachyos'));
 assert.throws(()=>sourceModulePlan([],'unknown'));
 assert.throws(()=>sourceModulePlan([],'nexus-cachyos',{enable:'steam-audio'}));
});
test('classification follows the pinned Makefile.in default assignments, not the guard branches',()=>{
 const makefile=fs.readFileSync(path.join(repository,'Makefile.in'),'utf8');
 const lines=makefile.split('\n');
 const assignments=lines.map(line=>/^(WITHOUT_[A-Z_]+)\s*(\?=|:=|=)\s*(.*)$/.exec(line.trim())).filter(Boolean);
 // ZLUDA and steam-audio are disabled by a default assignment. Removing a
 // configure opt-out cannot enable ZLUDA because its default stays 1. Both keep
 // the upstream ?= operator so an explicit opt-in still wins.
 assert.deepEqual(assignments.map(match=>[match[1],match[3].trim()]),[['WITHOUT_STEAM_AUDIO','1'],['WITHOUT_ZLUDA_LIBS','1']]);
 assert.deepEqual(assignments.map(match=>match[2]),['?=','?=']);
 const defaults=new Map(assignments.map(match=>[match[1],match[3].trim()]));
 for(const name of ['WITHOUT_EXTRAS','WITHOUT_NVIDIA_LIBS','WITHOUT_VKLAYERS'])assert.equal(defaults.has(name),false,`${name} must not have a default assignment`);
 for(const name of ['WITHOUT_EXTRAS','WITHOUT_NVIDIA_LIBS','WITHOUT_ZLUDA_LIBS','WITHOUT_VKLAYERS'])assert.ok(lines.some(line=>line.trim()===`ifneq ($(${name}),1)`),`${name} guard missing`);
 assert.ok(lines.some(line=>line.trim()==='ifneq ($(WITHOUT_STEAM_AUDIO),1)'));
 // The enabled namespaces really are part of the pinned build rules.
 for(const include of ['include $(SRC)/extras/build-dxvk-sarek.mk','include $(SRC)/nvidia-libs/build-nvcuda.mk','include $(SRC)/vklayers/build-vkbasalt.mk'])assert.ok(makefile.includes(include),include);
 // The plan is derived from the assignments: required for unset defaults,
 // excluded for the two namespaces the pinned defaults disable.
 const namespaces={'WITHOUT_EXTRAS':'extras/','WITHOUT_NVIDIA_LIBS':'nvidia-libs/','WITHOUT_ZLUDA_LIBS':'zluda-libs/','WITHOUT_VKLAYERS':'vklayers/','WITHOUT_STEAM_AUDIO':'steam-audio/'};
 const pinnedExcluded=Object.entries(namespaces).filter(([name])=>defaults.get(name)==='1').map(([,prefix])=>prefix).sort();
 assert.deepEqual(pinnedExcluded,['steam-audio/','zluda-libs/']);
 const modules=[{path:'wine',commit:pin},...Object.values(namespaces).map(prefix=>({path:prefix+'module',commit:pin}))];
 const plan=sourceModulePlan(modules,'nexus-cachyos');
 assert.deepEqual(plan.excluded.map(module=>module.path).sort(),pinnedExcluded.map(prefix=>prefix+'module'));
 assert.deepEqual(plan.required.map(module=>module.path),['wine','extras/module','nvidia-libs/module','vklayers/module']);
 assert.deepEqual(plan.enabledOptional,[]);
});
