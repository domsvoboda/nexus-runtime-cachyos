import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {project} from './inputs.mjs';
test('Proton prefix initialization keeps FEX local state outside the runtime',()=>{
  const result=execFileSync('python3',['-B',project+'/tests/fex-config.py'],{encoding:'utf8',timeout:10000});
  assert.match(result,/PASS actual Proton ARM setup/);
});
