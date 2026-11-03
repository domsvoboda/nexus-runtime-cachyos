// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {auxiliaryCacheKey} from './auxiliary-cache.mjs';
import {repository} from '../inputs.mjs';

test('auxiliary cache changes with recipe, locks, architecture and toolchain, not validation scripts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-cache-plan-'));
  try {
    await fs.mkdir(root+'/ci');await fs.writeFile(root+'/inputs.lock.json','pinned');
    await fs.writeFile(root+'/build-auxiliary.mjs','recipe');
    const key=()=>auxiliaryCacheKey(root,'x86_64','20261101');
    const initial=await key();await fs.writeFile(root+'/ci/validate-runtime.mjs','new checks');
    assert.equal(await key(),initial);
    await fs.writeFile(root+'/inputs.lock.json','changed pin');assert.notEqual(await key(),initial);
    await fs.writeFile(root+'/inputs.lock.json','pinned');await fs.writeFile(root+'/build-auxiliary.mjs','changed recipe');assert.notEqual(await key(),initial);
    assert.notEqual(await auxiliaryCacheKey(root,'arm64','20261101',{sha256:'a'}),await auxiliaryCacheKey(root,'arm64','20261101',{sha256:'b'}));
    assert.notEqual(await auxiliaryCacheKey(root,'x86_64','20261101'),await auxiliaryCacheKey(root,'arm64','20261101'));
    assert.notEqual(await key(),await auxiliaryCacheKey(root,'x86_64','20261102'));
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

test('both auxiliary cache paths install real compatibility test tools before running unchanged tests',async()=>{
  const workflow=await fs.readFile(path.join(repository,'.github/workflows/nexus-runtime.yml'),'utf8');
  const auxiliary=workflow.slice(workflow.indexOf('  auxiliary:'),workflow.indexOf('  runtime:'));
  const steps=auxiliary.split(/^      - /m).slice(1);
  const testIndex=steps.findIndex(step=>step.includes('run: node --test nexus/runtime-compat/*.test.mjs'));
  assert.ok(testIndex>0,'compatibility tests remain unconditional');
  assert.doesNotMatch(steps[testIndex],/\n        if:/);
  for(const cacheHit of [false,true]){
    const packages=[];
    for(const step of steps.slice(0,testIndex)){
      const condition=/\n        if: (.+)/.exec(step)?.[1];
      if(condition){
        assert.equal(condition,"steps.auxiliary-cache.outputs.cache-hit != 'true'");
        if(cacheHit)continue;
      }
      for(const match of step.matchAll(/apt-get[^\n]* install -y --no-install-recommends ([^\n]+)/g))packages.push(...match[1].trim().split(/\s+/));
    }
    for(const required of ['build-essential','gcc-mingw-w64-x86-64'])assert.ok(packages.includes(required),`${required} required when cache-hit=${cacheHit}`);
    assert.ok(packages.includes('binutils')||packages.includes('build-essential'),'objdump must be provided');
    if(!cacheHit)for(const required of ['cmake','gcc-multilib','gcc-mingw-w64-i686','curl','xz-utils'])assert.ok(packages.includes(required),required);
    else assert.ok(!packages.includes('gcc-mingw-w64-i686'),'cache hits do not install build-only i686 tools');
  }
  assert.ok(auxiliary.indexOf('Verify auxiliary inputs and bytes on cache hits and misses')>auxiliary.indexOf('runtime-compat/*.test.mjs'));
});
