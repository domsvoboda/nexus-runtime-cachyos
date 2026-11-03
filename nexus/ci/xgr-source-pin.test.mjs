// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pinnedXgrSource} from './xgr-source-pin.mjs';
import {project,repository} from '../inputs.mjs';
const inputs=JSON.parse(fs.readFileSync(project+'/inputs.lock.json','utf8'));
test('dependency source check selects only the validated exact XGR lock identity',()=>{
  assert.deepEqual(pinnedXgrSource(inputs),{repository:'domsvoboda/nexus-xgameruntime',commit:inputs.variant.xgameruntime});
  for(const replacement of ['main','latest','a'.repeat(39),null]){
    const changed=structuredClone(inputs);changed.variant.xgameruntime=replacement;assert.throws(()=>pinnedXgrSource(changed));
  }
  const changed=structuredClone(inputs);changed.variant.sourceRepository='untrusted/runtime';assert.throws(()=>pinnedXgrSource(changed));
});
test('required dependency contracts run unchanged from a complete exact checkout',()=>{
  const text=fs.readFileSync(repository+'/.github/workflows/nexus-source.yml','utf8');
  assert.ok(text.includes('run: node nexus/ci/xgr-source-pin.mjs'));
  assert.ok(text.includes('repository: ${{ steps.xgr-pin.outputs.repository }}'));
  assert.ok(text.includes('ref: ${{ steps.xgr-pin.outputs.commit }}'));
  assert.ok(text.includes('test "$(git rev-parse HEAD)" = "$EXPECTED_XGR_COMMIT"'));
  for(const file of ['test-policy','test-store-context','test-source-only','test-xml2-source'])assert.ok(text.includes('scripts/'+file+'.test.mjs'));
  assert.doesNotMatch(text,/continue-on-error|sparse-checkout/);
});
