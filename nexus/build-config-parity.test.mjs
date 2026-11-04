// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {repository} from './inputs.mjs';
import {CACHYOS_FAMILY,CACHYOS_FEATURE_MATRIX,defaultDisabledNamespacePrefixes,parseConfigureOptions,parseGuardBlocks,verifyFeatureMatrix,verifyLocalFeatureMatrix,verifyPinnedUpstreamParity} from './build-config-parity.mjs';
import {sourceModulePlan} from './source-module-plan.mjs';
import {sourceInventory} from './ci/initialize-source.mjs';
import {SDK_HOST_FLAGS,sdkConfigureArgs,sdkHostEnvironment} from './sdk-build-plan.mjs';
const read=relative=>fs.readFileSync(path.join(repository,relative),'utf8');
const inputs=JSON.parse(read('nexus/inputs.lock.json'));
const pin=inputs.variant.cachyosProton;
// Read-only Git object access. The pinned official source is an ancestor of
// this repository, so an exact comparison needs no network and no checkout.
const gitShow=(commit,file)=>{
 const result=spawnSync('git',['show',`${commit}:${file}`],{cwd:repository,encoding:'utf8',maxBuffer:32*1024*1024});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error(`The pinned official source ${commit} is required for the build parity contract: ${file}`);
 return result.stdout;
};
const localMakefile=read('Makefile.in'),localConfigure=read('configure.sh');
const upstreamMakefile=gitShow(pin,'Makefile.in'),upstreamConfigure=gitShow(pin,'configure.sh');

test('the local build configuration keeps the pinned official feature matrix',()=>{
 assert.match(pin,/^[a-f0-9]{40}$/);
 const ancestor=spawnSync('git',['merge-base','--is-ancestor',pin,'HEAD'],{cwd:repository});
 assert.equal(ancestor.status,0,'the pinned official source must remain an ancestor of the audited tree');
 const result=verifyPinnedUpstreamParity({upstreamMakefile,upstreamConfigure,currentMakefile:localMakefile,currentConfigure:localConfigure});
 assert.deepEqual(result.variables,[...CACHYOS_FEATURE_MATRIX.map(entry=>entry.variable)].sort());
 assert.deepEqual(result.defaultAssignments,{
  WITHOUT_STEAM_AUDIO:{operator:'?=',value:'1'},
  WITHOUT_ZLUDA_LIBS:{operator:'?=',value:'1'},
 });
 // Every upstream configure switch survives, including the opt-outs and the
 // wow64 and ccache build modes.
 for(const option of ['--enable-ccache','--enable-wow64','--target-arch','--without-tts','--without-nvidia-libs','--without-zluda-libs','--without-extras','--without-vklayers','--without-steamrt-depends'])assert.ok(result.configureOptions.includes(option),option);
});

test('steam-audio keeps the upstream opt-in operator instead of a hard override',()=>{
 // The pinned source uses ?= so an explicit opt-in still wins. A := override
 // silently removed that upstream capability and is the regression this
 // assertion exists for.
 assert.ok(upstreamMakefile.includes('WITHOUT_STEAM_AUDIO ?= 1'));
 assert.ok(localMakefile.includes('WITHOUT_STEAM_AUDIO ?= 1'));
 assert.equal(localMakefile.includes('WITHOUT_STEAM_AUDIO := 1'),false);
 assert.ok(localMakefile.includes('WITHOUT_ZLUDA_LIBS ?= 1'));
 const assignments=verifyFeatureMatrix({makefile:localMakefile,configure:localConfigure});
 assert.ok(assignments.variables.includes('WITHOUT_STEAM_AUDIO'));
});

test('the default fetch plan excludes exactly the default-disabled upstream namespaces',()=>{
 assert.deepEqual(defaultDisabledNamespacePrefixes(),['steam-audio/','zluda-libs/']);
 const inventory=sourceInventory();
 const plan=sourceModulePlan(inventory,CACHYOS_FAMILY);
 assert.equal(plan.required.length,50);
 assert.equal(plan.excluded.length,7);
 assert.deepEqual(plan.enabledOptional,[]);
 const excluded=plan.excluded.map(module=>module.path).sort();
 assert.deepEqual(excluded,[
  'steam-audio/flatbuffers','steam-audio/libmysofa','steam-audio/pffft','steam-audio/steam-audio','steam-audio/zlib',
  'zluda-libs/hipwine','zluda-libs/rocm-systems',
 ]);
 for(const module of plan.required)assert.ok(defaultDisabledNamespacePrefixes().every(prefix=>!module.path.startsWith(prefix)),module.path);
});

test('an explicit opt-in restores a default-disabled namespace without touching the others',()=>{
 const inventory=sourceInventory();
 const steam=sourceModulePlan(inventory,CACHYOS_FAMILY,{enable:['steam-audio']});
 assert.equal(steam.required.length,55);
 assert.equal(steam.excluded.length,2);
 assert.deepEqual(steam.enabledOptional,['steam-audio']);
 for(const module of steam.required.filter(module=>module.path.startsWith('steam-audio/')))assert.ok(module.commit);
 assert.deepEqual(steam.excluded.map(module=>module.path).sort(),['zluda-libs/hipwine','zluda-libs/rocm-systems']);
 const both=sourceModulePlan(inventory,CACHYOS_FAMILY,{enable:['zluda-libs','steam-audio']});
 assert.equal(both.required.length,57);
 assert.equal(both.excluded.length,0);
 assert.deepEqual(both.enabledOptional,['steam-audio','zluda-libs']);
 // Only reviewed default-disabled namespaces can be requested.
 for(const name of ['extras','tts','steamrtdeps','nvidia-libs','vklayers','unknown',''])assert.throws(()=>sourceModulePlan(inventory,CACHYOS_FAMILY,{enable:[name]}),/Unreviewed optional source feature/);
 assert.throws(()=>sourceModulePlan(inventory,CACHYOS_FAMILY,{enable:['steam-audio','steam-audio']}),/Duplicate optional source feature/);
 assert.throws(()=>sourceModulePlan(inventory,undefined,{enable:['steam-audio']}),/CachyOS variant/);
});

test('the parity verifier rejects silent feature stripping and flag loss',()=>{
 const check=(makefile,configure)=>verifyFeatureMatrix({makefile,configure});
 // Hard disabling a default-disabled optional namespace removes the upstream
 // opt-in, which is exactly what the pinned source preserves with ?=.
 assert.throws(()=>check(localMakefile.replace('WITHOUT_STEAM_AUDIO ?= 1','WITHOUT_STEAM_AUDIO := 1'),localConfigure),/must keep the upstream \?= operator/);
 // Disabling a feature that the pinned source builds by default.
 assert.throws(()=>check(localMakefile.replace('WITHOUT_STEAM_AUDIO ?= 1','WITHOUT_VKLAYERS := 1\nWITHOUT_STEAM_AUDIO ?= 1'),localConfigure),/must keep the pinned upstream default and build vklayers by default/);
 // Dropping a build fragment of an enabled namespace.
 assert.throws(()=>check(localMakefile.replace('include $(SRC)/nvidia-libs/build-nvenc.mk\n',''),localConfigure),/Missing build fragment for nvidia-libs/);
 // Dropping an upstream configure opt-out.
 assert.throws(()=>check(localMakefile,localConfigure.replace('[[ $arg = --without-vklayers ]]','[[ $arg = --without-vklayers-removed ]]')),/Missing upstream configure option: --without-vklayers/);
 // An unreviewed new feature default or guard must fail closed.
 assert.throws(()=>check(localMakefile.replace('WITHOUT_STEAM_AUDIO ?= 1','WITHOUT_STEAM_AUDIO ?= 1\nWITHOUT_FOO := 1'),localConfigure),/Unreviewed build feature default: WITHOUT_FOO/);
 assert.throws(()=>check(localMakefile.replace('WITHOUT_STEAM_AUDIO ?= 1','ifneq ($(WITHOUT_FOO),1)\nendif # WITHOUT_FOO\nWITHOUT_STEAM_AUDIO ?= 1'),localConfigure),/Unreviewed build feature guard: WITHOUT_FOO/);
 // The unmodified tree passes the same checks.
 assert.doesNotThrow(()=>verifyLocalFeatureMatrix(repository));
});

test('documented optional components stay in the default build plan',()=>{
 const documented=['extras/d7vk','extras/discord-rpc-bridge','extras/dxvk-low-latency','extras/dxvk-sarek','extras/vkd3d-low-latency','nvidia-libs/nvcuda','nvidia-libs/nvcuda32','nvidia-libs/nvenc','nvidia-libs/nvenc32','nvidia-libs/wine-nvml','nvidia-libs/wine-nvoptix','vklayers/Vulkan-Utility-Libraries','vklayers/low_latency_layer','vklayers/pyroveil','vklayers/vkbasalt','dxvk-nvapi'];
 const inventory=sourceInventory();
 const {required,excluded}=sourceModulePlan(inventory,CACHYOS_FAMILY);
 const requiredPaths=new Set(required.map(module=>module.path));
 for(const modulePath of documented)assert.ok(requiredPaths.has(modulePath),`documented component must stay in the default build: ${modulePath}`);
 // The Vulkan Reflex layer builds from the core dxvk-nvapi module, and
 // pyroveil has a known rights block, so neither may be silently dropped from
 // the default plan while the notice inventory is unresolved.
 assert.equal(excluded.some(module=>module.path==='dxvk-nvapi'),false);
});

test('gst-plugins-ugly stays one compiled default_pfx component',()=>{
 const makefile=read('Makefile.in');
 // The upstream gst_ugly block keeps the feature and its host dependency.
 // The Nexus duplicate block is not identical to it and was not removed; only
 // the repeated identical default_pfx dependency was dropped from the
 // aggregate target line.
 assert.ok(makefile.includes('GST_UGLY_HOST_DEPENDS = gst_orc'));
 const standalone=makefile.split('\n').filter(line=>line.trim()==='default_pfx: gst_ugly');
 assert.equal(standalone.length,1,'exactly one standalone gst_ugly default_pfx dependency');
 for(const line of makefile.split('\n')){
  if(!line.startsWith('default_pfx:')||line.trim()==='default_pfx: gst_ugly')continue;
  assert.equal(line.split(/\s+/).includes('gst_ugly'),false,'gst_ugly must not be repeated in another default_pfx dependency line');
 }
 for(const rule of ['$(eval $(call rules-source,gst_ugly,$(SRCDIR)/gstreamer/subprojects/gst-plugins-ugly/))','$(eval $(call rules-meson,gst_ugly,i386,unix))','$(eval $(call rules-meson,gst_ugly,x86_64,unix))','$(eval $(call rules-meson,gst_ugly,aarch64,unix))'])assert.ok(makefile.includes(rule),rule);
 // The aggregate default_pfx dependency line is exactly the pinned upstream one.
 assert.ok(makefile.includes('default_pfx: wine gst_good gst_bad gst_libav gst_plugins_rs lsteamclient steamexe vrclient wineopenxr $(WINEOPENXR64_JSON) dxvk dxvk-nvapi dxvk-igdext vkd3d-proton'));
});

test('the production build entry checks the feature matrix before any preparation',()=>{
 const runtime=read('nexus/build-runtime.mjs');
 assert.ok(runtime.includes("import {CACHYOS_FAMILY,verifyLocalFeatureMatrix} from './build-config-parity.mjs';"));
 assert.ok(runtime.includes("if(inputs.variant?.family===CACHYOS_FAMILY)verifyLocalFeatureMatrix(repository);"));
 assert.equal((runtime.match(/verifyLocalFeatureMatrix\(repository\)/g)||[]).length,1);
 const call=runtime.indexOf('verifyLocalFeatureMatrix(repository)');
 assert.ok(call>runtime.indexOf('await verifyInputs()'),'the check must follow verified inputs');
 assert.ok(call<runtime.indexOf('if(!resume){'),'the check must run on both fresh and resume paths');
 for(const marker of ['fs.mkdir(work','prepareXml2Source(','prepareFexSource(','configure.sh','sdkBuildPlan(','run(\'make\''])assert.ok(call<runtime.indexOf(marker),'the check must precede '+marker);
 // Execute the real production entry against a temporary source stub. The
 // broken upstream default must abort before the work directory exists, and
 // the reviewed default must pass the same guard. No SDK, generator, network
 // or make is involved: the script stops at the guard or at the empty
 // auxiliary directory immediately after it.
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-build-guard-'));
 try{
  fs.cpSync(path.join(repository,'nexus'),path.join(root,'nexus'),{recursive:true});
  fs.copyFileSync(path.join(repository,'Makefile.in'),path.join(root,'Makefile.in'));
  fs.copyFileSync(path.join(repository,'configure.sh'),path.join(root,'configure.sh'));
  const aux=path.join(root,'aux');fs.mkdirSync(aux);
  const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GITHUB_'))delete env[key];
  const invoke=resume=>spawnSync(process.execPath,[path.join(root,'nexus','build-runtime.mjs'),'--local',aux,path.join(root,'work'),path.join(root,'output'),...(resume?['--resume']:[])],{cwd:root,env,encoding:'utf8'});
  const reviewed=fs.readFileSync(path.join(root,'Makefile.in'),'utf8');
  fs.writeFileSync(path.join(root,'Makefile.in'),reviewed.replace('WITHOUT_STEAM_AUDIO ?= 1','WITHOUT_STEAM_AUDIO := 1'));
  const failed=invoke(false);
  assert.notEqual(failed.status,0);
  assert.match(failed.stderr,/WITHOUT_STEAM_AUDIO must keep the upstream \?= operator/);
  assert.equal(fs.existsSync(path.join(root,'work')),false,'the guard must precede work directory creation');
  assert.equal(fs.existsSync(path.join(root,'output')),false);
  // The guard runs before the fresh/resume split, so the resume entry must
  // reject the same broken default without reading a prepared state file.
  const failedResume=invoke(true);
  assert.notEqual(failedResume.status,0);
  assert.match(failedResume.stderr,/WITHOUT_STEAM_AUDIO must keep the upstream \?= operator/);
  fs.writeFileSync(path.join(root,'Makefile.in'),reviewed);
  const reached=invoke(false);
  assert.notEqual(reached.status,0);
  assert.doesNotMatch(reached.stderr,/must keep the upstream \?= operator/);
  assert.equal(fs.existsSync(path.join(root,'work')),false,'the unmodified tree must not create a work directory without auxiliary inputs');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('the CachyOS configure command keeps the upstream feature set and host baseline',()=>{
 const sdk='registry.gitlab.steamos.cloud/proton/steamrt4/sdk/x86_64@sha256:'+'a'.repeat(64);
 const args=sdkConfigureArgs({name:'runtime-g12345678',engine:'docker',sdk,variant:CACHYOS_FAMILY});
 assert.deepEqual(args,['--build-name=runtime-g12345678','--container-engine=docker',`--proton-sdk-image=${sdk}`,'--enable-ccache']);
 for(const arg of args)assert.doesNotMatch(arg,/^--(?:without-|disable-|enable-wow64)/,arg);
 // The reviewed host profile stays on the official instruction set baseline.
 assert.deepEqual({...SDK_HOST_FLAGS},{CFLAGS:'-O2 -march=nocona -mtune=core-avx2',RUSTFLAGS:'-Copt-level=3 -Ctarget-cpu=nocona'});
 assert.deepEqual(sdkHostEnvironment(CACHYOS_FAMILY),SDK_HOST_FLAGS);
 assert.deepEqual(sdkHostEnvironment(undefined),{});
 assert.throws(()=>sdkHostEnvironment('nexus-other'));
 // The build path must share the reviewed profile instead of duplicating it.
 const runtime=read('nexus/build-runtime.mjs');
 assert.ok(runtime.includes('sdkHostEnvironment(inputs.variant.family)'),'build-runtime must use the reviewed host profile');
 assert.equal(/CFLAGS\s*:\s*['"][^'"]*-march=/.test(runtime),false,'build-runtime must not duplicate the host flags');
});

test('the pinned official source really declares the reviewed upstream matrix',()=>{
 // Double entry: the manifest is compared with the pinned source itself, not
 // only with the local tree, so a manifest edit cannot weaken the contract.
 assert.doesNotThrow(()=>verifyFeatureMatrix({makefile:upstreamMakefile,configure:upstreamConfigure}));
 const guards=parseGuardBlocks(upstreamMakefile);
 assert.deepEqual([...new Set(guards.variables)].sort(),CACHYOS_FEATURE_MATRIX.map(entry=>entry.variable).sort());
 const options=parseConfigureOptions(upstreamConfigure);
 for(const entry of CACHYOS_FEATURE_MATRIX)if(entry.configureOption)assert.ok(options.has(entry.configureOption),entry.configureOption);
});
