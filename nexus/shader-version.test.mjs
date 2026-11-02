// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireShaderVersion} from './shader-version.mjs';
test('the pinned shader version accepts upstream Autoconf spacing, never another version',()=>{
  for(const source of ['AC_INIT([vkd3d],[2.1])','AC_INIT([vkd3d], [2.1])','AC_PREREQ([2.69])\nAC_INIT( [vkd3d] , [2.1] )'])assert.doesNotThrow(()=>requireShaderVersion(source,'2.1'));
  for(const source of ['AC_INIT([vkd3d],[2.0])','AC_INIT([another],[2.1])','# AC_INIT([vkd3d],[2.1])',''])assert.throws(()=>requireShaderVersion(source,'2.1'));
});
