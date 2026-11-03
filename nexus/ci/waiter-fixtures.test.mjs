// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {repository} from '../inputs.mjs';
import {requiredWaiterFixtures,assertWaiterRunner,verifyWaiterFixtures,assertWaiterResult} from './waiter-fixtures.mjs';
const inputs={variant:{family:'nexus-cachyos'}},sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function pe(machine){const bytes=Buffer.alloc(256);bytes.write('MZ');bytes.writeUInt32LE(128,60);bytes.write('PE\0\0',128,'binary');bytes.writeUInt16LE(machine,132);return bytes;}
async function fixture(fn){
  const root=await fs.mkdtemp(path.join(repository,'.waiter-fixture-'));
  try{const hashes={};for(const relative of requiredWaiterFixtures(inputs)){const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});const bytes=pe(relative.startsWith('win64/')?0x8664:0x14c);await fs.writeFile(file,bytes);hashes[relative]=sha(bytes);}await fn(root,hashes);}finally{await fs.rm(root,{recursive:true,force:true});}
}
test('both ABI waiter executables must be present, hashed and the correct PE machine',()=>fixture(async(root,hashes)=>{
  assert.equal(requiredWaiterFixtures(inputs).length,2);assert.deepEqual(requiredWaiterFixtures({}),[]);
  await verifyWaiterFixtures(root,inputs,hashes);
  for(const relative of requiredWaiterFixtures(inputs)){
    const missing={...hashes};delete missing[relative];await assert.rejects(verifyWaiterFixtures(root,inputs,missing),/inventory/);
    await assert.rejects(verifyWaiterFixtures(root,inputs,{...hashes,[relative]:'a'.repeat(64)}),/Changed/);
  }
  const relative=requiredWaiterFixtures(inputs)[1],bytes=pe(0x8664);await fs.writeFile(path.join(root,relative),bytes);
  await assert.rejects(verifyWaiterFixtures(root,inputs,{...hashes,[relative]:sha(bytes)}),/ABI/);
}));
test('waiter executable links and malformed PE bytes fail before native execution',()=>fixture(async(root,hashes)=>{
  const relative=requiredWaiterFixtures(inputs)[0],file=path.join(root,relative),copy=file+'.copy';await fs.rename(file,copy);await fs.symlink(copy,file);
  await assert.rejects(verifyWaiterFixtures(root,inputs,hashes),/regular/);await fs.unlink(file);await fs.writeFile(file,Buffer.from('truncated'));
  await assert.rejects(verifyWaiterFixtures(root,inputs,{...hashes,[relative]:sha(Buffer.from('truncated'))}),/ABI/);
}));
test('pinned component runner must retain the mandatory 96-check gate',()=>{
  assertWaiterRunner(inputs,"['nexus_taskqueue-composite-waiters', 96]");assertWaiterRunner(inputs,"['nexus_taskqueue-composite-waiters', 100]");
  for(const text of ['',"['nexus_taskqueue-composite-waiters', 95]","['unrelated',96]"])assert.throws(()=>assertWaiterRunner(inputs,text));
});
test('native result must contain exactly one successful numeric waiter coverage record',()=>{
  const valid={passed:true,results:[{name:'nexus_taskqueue-composite-waiters',checks:96,failures:0}]};assertWaiterResult(inputs,valid);
  for(const checks of [undefined,null,NaN,Infinity,'96',95,96.5,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>assertWaiterResult(inputs,{...valid,results:[{...valid.results[0],checks}]}));
  for(const changed of [{passed:'true',results:valid.results},{passed:false,results:valid.results},{passed:true},{passed:true,results:{}},{passed:true,results:[]},{passed:true,results:[...valid.results,...valid.results]},{passed:true,results:[{...valid.results[0],failures:1}]}])assert.throws(()=>assertWaiterResult(inputs,changed));
});
test('generation, checkpoint and validation retain the new probe without weakening outer gates',async()=>{
  const read=name=>fs.readFile(path.join(repository,name),'utf8');
  const build=await read('nexus/ci/build-fixtures.mjs');assert.match(build,/for\(const abi of \['win64','win32'\]\)/);assert.ok(build.includes("'cmake','--build','/fixtures/'+abi,'--parallel','4'"));
  assert.ok(build.includes('await verifyWaiterFixtures(root,built.inputs,hashes)'));assert.ok(build.includes("root+'/win64/bin',root+'/win32/bin'"));
  const validate=await read('nexus/ci/validate-runtime.mjs');assert.ok(validate.includes('await verifyWaiterFixtures(fixtures,built.inputs,fixtureProof.hashes)'));assert.ok(validate.includes('assertWaiterRunner(built.inputs,text)'));assert.ok(validate.includes('assertWaiterResult(built.inputs,'));assert.match(validate,/for\(const \[abi,arch\]of \[\['win64','x86_64'\],\['win32','i386'\]\]\)/);
  assert.ok(validate.includes('validateGateResults(proof.results)'));
  const checkpoint=await read('nexus/ci/runtime-checkpoint.py');assert.ok(checkpoint.includes('fixtures'));assert.doesNotMatch(checkpoint,/taskqueue-composite-waiters.*(?:exclude|skip)/);
});
