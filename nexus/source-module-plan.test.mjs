// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceModulePlan} from './source-module-plan.mjs';
const pin='a'.repeat(40);
test('conservative source graph excludes only disabled optional namespaces, preserving their pins',()=>{
 const modules=['wine','dxvk','gstreamer','extras/dxvk-sarek','zluda-libs/rocm-systems','nvidia-libs/nvcuda','vklayers/vkbasalt','steam-audio/steam-audio','extras-other'].map(path=>({path,commit:pin}));
 const {required,excluded}=sourceModulePlan(modules,'nexus-cachyos');
 assert.deepEqual(required.map(x=>x.path),['wine','dxvk','gstreamer','extras-other']);
 assert.equal(excluded.length,5);assert.ok(excluded.every(x=>x.commit===pin));
 assert.equal(sourceModulePlan(modules).required.length,modules.length);
});
test('source module planning rejects alias traversal, duplicate paths and mutable pins',()=>{
 for(const modules of [[{path:'../wine',commit:pin}],[{path:'wine',commit:'main'}],[{path:'wine',commit:pin},{path:'wine',commit:pin}]])assert.throws(()=>sourceModulePlan(modules,'nexus-cachyos'));
 assert.throws(()=>sourceModulePlan([],'unknown'));
});
