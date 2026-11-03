// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {repository} from '../inputs.mjs';
import {sourceInitializationArgs} from './initialize-source.mjs';
test('source initialization supplies only explicit pinned required modules',()=>{
 const modules=['wine','gstreamer','zluda-libs/rocm-systems','extras/d7vk'].map(path=>({path,commit:'a'.repeat(40)}));
 assert.deepEqual(sourceInitializationArgs(modules,'nexus-cachyos'),['submodule','update','--init','--recursive','--','wine','gstreamer']);
 assert.throws(()=>sourceInitializationArgs([],'nexus-cachyos'));
 assert.throws(()=>sourceInitializationArgs(modules.slice(2),'nexus-cachyos'));
});
test('x64 candidate workflow initializes the bounded plan rather than all submodules',()=>{
 const text=fs.readFileSync(path.join(repository,'.github/workflows/nexus-runtime.yml'),'utf8');
 assert.doesNotMatch(text,/submodules:\s*recursive/);
 assert.match(text,/node nexus\/ci\/initialize-source\.mjs --initialize/);
 assert.ok(text.indexOf('initialize-source.mjs --initialize')<text.indexOf('node nexus/build-runtime.mjs'));
});
