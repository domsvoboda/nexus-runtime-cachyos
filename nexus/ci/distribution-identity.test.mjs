// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyInputs} from '../inputs.mjs';
import {distributionIdentity,distributionName} from './distribution-identity.mjs';
const {inputs}=await verifyInputs();
test('packaging identity derives from exact allowlisted pinned variant, not runtime strings',()=>{
 assert.equal(distributionIdentity(inputs).repository,'domsvoboda/nexus-runtime-cachyos');
 assert.equal(distributionName(inputs,'a'.repeat(40)),'nexus-runtime-cachyos-11.0-experimental-gaaaaaaaa');
 const standard=structuredClone(inputs);delete standard.variant;
 assert.equal(distributionIdentity(standard).repository,'domsvoboda/nexus-runtime');
 assert.equal(distributionName(standard,'a'.repeat(40)),'nexus-runtime-11.0-experimental-gaaaaaaaa');
 for(const repository of ['fork/nexus-runtime-cachyos','domsvoboda/other']){
  const untrusted=structuredClone(inputs);untrusted.variant.sourceRepository=repository;assert.throws(()=>distributionIdentity(untrusted));
 }
 assert.throws(()=>distributionName(inputs,'main'));
});
