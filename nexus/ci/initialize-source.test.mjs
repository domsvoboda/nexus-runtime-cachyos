// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {repository} from '../inputs.mjs';
import {sourceInitializationArgs, sourceInventory} from './initialize-source.mjs';
import {sourceModulePlan} from '../source-module-plan.mjs';
import {sourceArchiveArgs} from './source-archive.mjs';
test('source initialization supplies the upstream-enabled modules and skips the default-disabled ones',()=>{
 const modules=['wine','gstreamer','zluda-libs/rocm-systems','extras/d7vk','nvidia-libs/nvcuda','vklayers/vkbasalt','steam-audio/steam-audio'].map(path=>({path,commit:'a'.repeat(40)}));
 assert.deepEqual(sourceInitializationArgs(modules,'nexus-cachyos'),['submodule','update','--init','--recursive','--','wine','gstreamer','extras/d7vk','nvidia-libs/nvcuda','vklayers/vkbasalt']);
 // The undefined variant is unchanged: no module is treated as excluded.
 assert.deepEqual(sourceInitializationArgs(modules,undefined),['submodule','update','--init','--recursive','--',...modules.map(module=>module.path)]);
 assert.throws(()=>sourceInitializationArgs([],'nexus-cachyos'));
 assert.throws(()=>sourceInitializationArgs(modules.slice(-1),'nexus-cachyos'));
 assert.throws(()=>sourceInitializationArgs(modules.slice(2,3),'nexus-cachyos'));
});
test('x64 candidate workflow initializes the bounded plan rather than all submodules',()=>{
 const text=fs.readFileSync(path.join(repository,'.github/workflows/nexus-runtime.yml'),'utf8');
 assert.doesNotMatch(text,/submodules:\s*recursive/);
 assert.match(text,/node nexus\/ci\/initialize-source\.mjs --initialize/);
 assert.ok(text.indexOf('initialize-source.mjs --initialize')<text.indexOf('node nexus/build-runtime.mjs'));
});
test('the committed pinned inventory keeps only the upstream-enabled component set',()=>{
 const inventory=sourceInventory();
 assert.equal(inventory.length,57);
 const {required,excluded}=sourceModulePlan(inventory,'nexus-cachyos');
 assert.equal(required.length,50);
 assert.equal(excluded.length,7);
 assert.deepEqual(excluded.map(module=>module.path).sort(),['steam-audio/flatbuffers','steam-audio/libmysofa','steam-audio/pffft','steam-audio/steam-audio','steam-audio/zlib','zluda-libs/hipwine','zluda-libs/rocm-systems']);
 // ZLUDA keeps its pinned commits but stays out of this restoration stage.
 const excludedByPath=new Map(excluded.map(module=>[module.path,module.commit]));
 assert.equal(excludedByPath.get('zluda-libs/hipwine'),'126605cda75efdbd92f9ee78d5dfee0f46074561');
 assert.equal(excludedByPath.get('zluda-libs/rocm-systems'),'6b0e43f341195e203754e08f850e437ff2fc09f9');
 // Exact pinned paths and commits for the 15 restored modules.
 const expected={
  'extras/d7vk':'ff123cb08ff1fcf6575a6ef8fb79d824a84e56c4',
  'extras/discord-rpc-bridge':'6aa60772a5241c7bd1b8d38f026b2a5168e0f93c',
  'extras/dxvk-low-latency':'d533db09df35453ed1baa1b0c7d86de2b67bf504',
  'extras/dxvk-sarek':'0c0e8f6f62c7cb37dbf5d38413517efa00c08fef',
  'extras/vkd3d-low-latency':'f4e0518cdd35fee0629e25367422bcbc17cbc122',
  'nvidia-libs/nvcuda':'8982084679efc390d217a7f67553f1e319eefe10',
  'nvidia-libs/nvcuda32':'1993a7c745e08f8bfb11502b7489dd7fba70a08f',
  'nvidia-libs/nvenc':'09ec9e1c8b25a351e415a6d0361bfacad0fd710c',
  'nvidia-libs/nvenc32':'ff7220eb8a19ea7e0db8bd5c401a50b606712ff7',
  'nvidia-libs/wine-nvml':'a1a7d8fac0e054122cbaf9205c9bee33f5831015',
  'nvidia-libs/wine-nvoptix':'ea2e23341ab84bcbebbf191f7f04cac13f1ac95b',
  'vklayers/Vulkan-Utility-Libraries':'b538fb5b08513aa78346cd414ad5e576a2a3e920',
  'vklayers/low_latency_layer':'3138b14ebd059cd540444771dd184fbf7ead2a12',
  'vklayers/pyroveil':'e1f547372cf1b9d14da56621716d2137088d0061',
  'vklayers/vkbasalt':'4f97f09ffe91900e6ca136cc26cf7966f8f6970d',
 };
 const byPath=new Map(required.map(module=>[module.path,module.commit]));
 for(const [modulePath,commit] of Object.entries(expected))assert.equal(byPath.get(modulePath),commit,modulePath);
 // steam-audio stays declared but excluded, like ZLUDA, because the pinned
 // upstream defaults disable both namespaces.
 const gitmodules=fs.readFileSync(path.join(repository,'.gitmodules'),'utf8');
 for(const module of excluded)assert.ok(gitmodules.includes(`path = ${module.path}`),module.path);
 // The initializer would fetch the restored namespaces, not merely list them.
 const args=sourceInitializationArgs(inventory,'nexus-cachyos');
 for(const modulePath of Object.keys(expected))assert.ok(args.includes(modulePath),modulePath);
 for(const module of excluded)assert.equal(args.includes(module.path),false,module.path);
});
test('corresponding source keeps every required module and adds no new exclusion',()=>{
 const args=sourceArchiveArgs('/tmp/source.tar.xz','/source','/aux','/work','4.4.8');
 assert.deepEqual(args.filter(arg=>arg.startsWith('--exclude=')),['--exclude=.git','--exclude=./contrib']);
 assert.ok(args.includes('/source')&&args.includes('.'));
 const {required,excluded}=sourceModulePlan(sourceInventory(),'nexus-cachyos');
 for(const module of required)assert.ok(!module.path.startsWith('steam-audio/')&&!module.path.startsWith('zluda-libs/'),module.path);
 assert.ok(excluded.every(module=>module.path.startsWith('steam-audio/')||module.path.startsWith('zluda-libs/')));
 assert.ok(fs.existsSync(path.join(repository,'nexus/licenses')),'license inventory stays inside the archived source tree');
});
