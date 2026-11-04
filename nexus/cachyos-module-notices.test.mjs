// SPDX-License-Identifier: MIT
// Source-only contract tests for the expanded CachyOS notice manifest. They never
// require initialized module trees, never download, never build and never compile.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateNoticeManifest,sourceNoticePlan,derivedNoticeName,verifyNoticePlan} from './source-notices.mjs';
import {sdkNoticeNames} from './sdk-notices.mjs';
const project=path.dirname(fileURLToPath(import.meta.url));
const repository=path.dirname(project);
const manifestFile=path.join(project,'licenses/cachyos-module-notices.json');
const nvmlModule='nvidia-libs/wine-nvml';
const nvmlExternalPath='src/nvml_610.43.02.h';
const readManifest=()=>JSON.parse(fs.readFileSync(manifestFile,'utf8'));
const clone=value=>JSON.parse(JSON.stringify(value));
const excludedCommits=Object.freeze({
 'extras/vkd3d-low-latency/subprojects/dxil-spirv/third_party/SPIRV-Cross':'be71ee8c12cd7dc5ca8fa9581f708c2e8561fe2a',
 'extras/vkd3d-low-latency/subprojects/dxil-spirv/third_party/SPIRV-Tools':'199cb207b911501ddd76dcddf100a6e21c15ef23',
 'vklayers/pyroveil/third_party/rapidjson/thirdparty/gtest':'ba96d0b1161f540656efdaed035b3c062b60e006'
});
const nvoptixHeaders=Object.freeze({
 'src/nvoptix_22.h':'37e8a87bc78b74a94528203133dfd818b2eb6fd7fe398e45009b9d5551098504',
 'src/nvoptix_36.h':'e0a6b4f8f75731f5af72127a37e0f3015c1752a633861006d7f11799f90dc007',
 'src/nvoptix_41.h':'a9c71f4787be6565a64a12cd4633a04c439601948a83028217476428f1a35b33',
 'src/nvoptix_47.h':'4b5338ac2d597239864ded837f33605de04cf1296a57431bfb2c4c8232a330e0',
 'src/nvoptix_55.h':'0b583ea475d277d9490b77752da5018bff5a58d727c32d523299d0f5212c2041',
 'src/nvoptix_60.h':'dfd62f83a8ab816f82f925180c5b27c3849b0642b9a31c3d3bed22cb4b560e75',
 'src/nvoptix_68.h':'f74216acecf7604f1d9c0249ae0a61ac5914eac81d4c6775ae17780f794efc74',
 'src/nvoptix_84.h':'91429d9092815a312e03b165611ae40f421fc5e185dc935c882b16134f7461dd',
 'src/nvoptix_87.h':'2c2d24efe781453bc28d5a920f5720d127b795742dd50890a84edc4de6ca6fe9',
 'src/nvoptix_93.h':'308896c2fc8646167d11edacad78e8e41a19bbe40a1fa6743ff24d73a12073ce',
 'src/nvoptix_105.h':'73d476f365f7e0df7f37fdd37aea8f1be73e0d8ad0185d44536fa412f1d097b7',
 'src/nvoptix_118.h':'ce30bfad9c126e3559d4e2d2def34c82cabdb27d2ecfa961f0695c685fc8da8f',
 'src/nvoptix.h':'63dcb3c46119d935163655fbd1f58a53a60a5b7b9404407049429a1b12eb3668'
});
const pyroveilHacks=Object.freeze(['hacks/ac-shadows-nvidia-570-stable/pyroveil.json','hacks/ffvii-rebirth-nvidia/pyroveil.json','hacks/monster-hunter-wilds-benchmark-nv/cache/97ccc02f3db80d2e.asm','hacks/monster-hunter-wilds-benchmark-nv/cache/97ccc02f3db80d2e.old.asm','hacks/monster-hunter-wilds-benchmark-nv/cache/97ccc02f3db80d2e.orig.spv','hacks/monster-hunter-wilds-benchmark-nv/cache/97ccc02f3db80d2e.spv','hacks/monster-hunter-wilds-benchmark-nv/pyroveil.json','hacks/roadcraft-nvidia-570-stable/pyroveil.json','hacks/surviving-mars-relaunched-nv-580-stable/pyroveil.json']);
const embeddedNotices=Object.freeze({
 'vklayers/vkbasalt':['src/stb_image.h','src/stb_image_resize.h','src/shader/smaa.h','src/shader/fxaa3_11.h','src/shader/cas.frag.glsl','src/shader/deband.frag.glsl','src/shader/dls.frag.glsl'],
 'extras/vkd3d-low-latency':['include/private/nvShaderExtnEnums.h','libs/vkd3d-shader/checksum.c','libs/vkd3d/shaders/cs_gdeflate.comp'],
 'nvidia-libs/nvcuda':['dlls/nvcuda/encryption.c','dlls/nvcuda/encryption.h','dlls/nvcuda/function_mappings.c','dlls/nvcuda/function_mappings.h','dlls/nvcuda/internal.c','dlls/nvcuda/nvcuda.c','dlls/nvcuda/nvcuda.h','dlls/nvcuda_fdll/nvcuda.rc','include/cuda.h'],
 'nvidia-libs/nvcuda32':['dlls/nvcuda/internal.c','dlls/nvcuda/nvcuda.c','dlls/nvcuda/nvcuda.h','include/cuda.h'],
 'nvidia-libs/nvenc':['dlls/nvcuvid/nvcuvid.c','dlls/nvcuvid_fdll/nvcuvid.rc','dlls/nvencodeapi/nvencodeapi.c','dlls/nvencodeapi_fdll/nvencodeapi.rc','include/cuda.h','include/cuviddec.h','include/nvcuvid.h','include/nvencodeapi.h'],
 'nvidia-libs/nvenc32':['dlls/nvcuvid/nvcuvid.c','dlls/nvencodeapi/nvencodeapi.c','include/cuda.h','include/cuviddec.h','include/nvcuvid.h','include/nvencodeapi.h']
});
const reservedNames=Object.freeze(['FEX-LICENSE','runtime-compat-LICENSE','NOTICE','nghttp2-LICENSE','Wine-LICENSE','TomCrypt-LICENSE','xgameruntime-LICENSE','FFmpeg-COPYING.LGPLv2.1',...sdkNoticeNames,'XGR-XML2-COPYING','GLib-COPYING','portable-glib.json','libva-COPYING','portable-libva.json']);
function inventoryOf(document){
  return [...document.modules.map(module=>({path:module.path,commit:module.commit})),...document.excluded.map(entry=>({path:entry.path,commit:excludedCommits[entry.path]}))];
}
function planOf(document){
  return sourceNoticePlan({manifests:[{file:'cachyos-module-notices.json',document}],inventory:inventoryOf(document)});
}
function gitlink(modulePath,root=repository){
  const line=execFileSync('git',['ls-tree','HEAD','--',modulePath],{cwd:root,encoding:'utf8'}).trim();
  const match=/^160000 commit ([a-f0-9]{40})\t/.exec(line);
  assert.ok(match,'missing gitlink for '+modulePath+' under '+root);
  return match[1];
}
function moduleOf(document,modulePath){
  const module=document.modules.find(entry=>entry.path===modulePath);
  assert.ok(module,'missing module entry '+modulePath);
  return module;
}
function assertNotices(document,modulePath,paths){
  const module=moduleOf(document,modulePath);
  const noticePaths=new Set(module.notices.map(notice=>notice.path));
  const contextPaths=new Set((module.contextFiles??[]).map(file=>file.path));
  for(const file of paths){
    assert.ok(noticePaths.has(file),'embedded licensed code is not staged as a notice: '+modulePath+'/'+file);
    assert.ok(!contextPaths.has(file),'embedded licensed code must not stay context only: '+modulePath+'/'+file);
  }
}
function nvmlHeaderFixture(){
  const fixture=process.env.NVML_HEADER_FIXTURE;
  if(!fixture)return null;
  const stat=fs.lstatSync(fixture);
  assert.ok(stat.isFile(),'NVML_HEADER_FIXTURE must be a regular file');
  const bytes=fs.readFileSync(fixture);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const lockPath=path.join(project,'nvml-header.lock.json');
  let commit;
  if(fs.existsSync(lockPath)){
    const lock=JSON.parse(fs.readFileSync(lockPath,'utf8'));
    assert.equal(lock.module,nvmlModule);
    assert.equal(lock.name,'nvml.h');
    assert.match(lock.commit,/^[a-f0-9]{40}$/);
    assert.equal(sha256,lock.sha256,'NVML fixture hash differs from nvml-header.lock.json');
    assert.equal(bytes.length,lock.bytes,'NVML fixture size differs from nvml-header.lock.json');
    commit=lock.commit;
  }
  return {path:nvmlExternalPath,bytes,sha256,commit};
}
test('the committed expanded manifest is schema valid, complete and free of a rights veto',()=>{
  const document=readManifest();
  assert.equal(document.schema,1);
  assert.equal(document.kind,'source-notices');
  assert.equal(document.family,'nexus-cachyos');
  assert.equal(document.status,'ready');
  assert.equal('blockers' in document,false);
  assert.equal(validateNoticeManifest(document,'cachyos-module-notices.json').status,'ready');
  assert.ok(document.modules.every(module=>module.status==='ready'),'a ready manifest has no blocked module');
  // Inventory readiness records the pinned notice set. It must not assert an
  // agreement, acceptance or a licence reclassification.
  const text=JSON.stringify(document);
  assert.doesNotMatch(text,/user has accepted|accepted agreement|granted rights|relicensed|legal certif/i);
});
test('coverage, modules, exclusions and the external gap are structurally sound',()=>{
  const document=readManifest();
  assert.ok(document.coverage.length>0);
  for(const root of document.coverage)assert.ok(document.modules.some(module=>module.path===root),'coverage root without module '+root);
  for(const module of document.modules){
    assert.match(module.commit,/^[a-f0-9]{40}$/);
    assert.ok(document.coverage.some(root=>module.path===root||module.path.startsWith(root+'/')),'module outside coverage '+module.path);
    for(const notice of module.notices)assert.match(notice.sha256,/^[a-f0-9]{64}$/);
    for(const file of module.contextFiles??[])assert.match(file.sha256,/^[a-f0-9]{64}$/);
  }
  const blocked=document.modules.filter(module=>module.status==='blocked').map(module=>module.path).sort();
  assert.deepEqual(blocked,[]);
  for(const module of document.modules.filter(entry=>entry.status==='blocked'))assert.ok(module.blockers.length>0,module.path+' must list blockers');
  const external=document.externalSources[0];
  assert.equal(external.module,'nvidia-libs/wine-nvml');
  assert.equal(external.path,'src/nvml_610.43.02.h');
  assert.equal(external.status,'resolved');
  assert.equal(external.commit,'5b341a9e54f08ac324e148e1e7e102030e42b1c4');
  assert.equal(external.sha256,'31a26e3ce6f0b98a76cea38a3cf28aa112a20cfb37e9057786c768712d6a487f');
  const nvmlNotice=moduleOf(document,'nvidia-libs/wine-nvml').notices.find(notice=>notice.path==='src/nvml_610.43.02.h');
  assert.ok(nvmlNotice,'the resolved external header must also be staged as a notice');
  assert.equal(nvmlNotice.sha256,external.sha256);
});
test('embedded licensed shipped code is staged as a notice, not context only',()=>{
  const document=readManifest();
  for(const [modulePath,paths] of Object.entries(embeddedNotices))assertNotices(document,modulePath,paths);
  const vkbasalt=moduleOf(document,'vklayers/vkbasalt');
  assert.equal(vkbasalt.status,'ready');
  assert.equal((vkbasalt.blockers??[]).length,0);
  const dds=(vkbasalt.contextFiles??[]).find(file=>file.path==='src/stb_image_dds.h');
  assert.ok(dds,'accepted SOIL DDS context must be preserved');
  assert.equal(dds.sha256,'84d487d505f8294f9718dfcbee301c9ff026006303dafe217994ad63fed9e5ce');
});
test('pyroveil is covered by the project MIT grant and keeps all nine shipped hacks files anchored as context',()=>{
  const module=moduleOf(readManifest(),'vklayers/pyroveil');
  assert.equal(module.status,'ready');
  assert.equal((module.blockers??[]).length,0);
  const notice=module.notices.find(entry=>entry.path==='LICENSE');
  assert.ok(notice,'the project license must stay staged as a notice');
  assert.equal(notice.sha256,'20bab0c079d29b2ddfea376499519994c045ed54182d64b46837fcebdf636e3f');
  const paths=(module.contextFiles??[]).map(file=>file.path).sort();
  assert.deepEqual(paths,[...pyroveilHacks].sort());
});
test('top level expanded pins match the committed gitlinks',()=>{
  const document=readManifest();
  for(const root of document.coverage)assert.equal(moduleOf(document,root).commit,gitlink(root));
});
test('the plan derives notice and context totals and carries no rights blocker',()=>{
  const document=readManifest();
  const plan=planOf(document);
  assert.equal(plan.modules.length,document.modules.length);
  assert.equal(plan.notices.length,document.modules.reduce((total,module)=>total+module.notices.length,0));
  assert.equal(plan.contextFiles.length,document.modules.reduce((total,module)=>total+(module.contextFiles??[]).length,0));
  assert.deepEqual(plan.blockers,[]);
  assert.equal(plan.notices.filter(notice=>notice.module==='nvidia-libs/wine-nvoptix').length,16);
  const names=plan.notices.map(notice=>notice.name);
  assert.equal(new Set(names).size,names.length);
  for(const notice of plan.notices){
    assert.ok(!reservedNames.includes(notice.name),'reserved legacy notice name reused: '+notice.name);
    assert.equal(derivedNoticeName(notice.module,notice.path),notice.name);
  }
});
test('fail closed on missing, repinned and unknown module inventory',()=>{
  const document=readManifest();
  const baselineInventory=inventoryOf(document);
  const missingInventory=baselineInventory.filter(entry=>entry.path!=='extras/d7vk');
  assert.throws(()=>sourceNoticePlan({manifests:[{file:'cachyos-module-notices.json',document}],inventory:missingInventory}),/absent from the source graph/);
  const repinned=clone(document);
  moduleOf(repinned,'extras/d7vk').commit='0'.repeat(40);
  assert.throws(()=>sourceNoticePlan({manifests:[{file:'cachyos-module-notices.json',document:repinned}],inventory:baselineInventory}),/does not match the recorded gitlink/);
  const extra=[...baselineInventory,{path:'extras/d7vk/unknown-header-tree',commit:'1'.repeat(40)}];
  assert.throws(()=>sourceNoticePlan({manifests:[{file:'cachyos-module-notices.json',document}],inventory:extra}),/Uncovered checked-out submodule|not covered by a notice manifest/);
});
test('fail closed on malformed, blocked or unresolved shapes',()=>{
  const document=readManifest();
  const noBlockers=clone(document);
  const blockedWithoutBlockers=moduleOf(noBlockers,'nvidia-libs/wine-nvoptix');
  blockedWithoutBlockers.status='blocked';
  delete blockedWithoutBlockers.blockers;
  assert.throws(()=>validateNoticeManifest(noBlockers,'fixture'),/blocked entry must list at least one blocker/);
  const emptyNotices=clone(document);
  moduleOf(emptyNotices,'extras/d7vk').notices=[];
  assert.throws(()=>validateNoticeManifest(emptyNotices,'fixture'),/modules require notices/);
  const outside=clone(document);
  outside.excluded[0].path='elsewhere/not-built';
  assert.throws(()=>validateNoticeManifest(outside,'fixture'),/outside every coverage path/);
  const duplicate=clone(document);
  duplicate.coverage.push(duplicate.coverage[0]);
  assert.throws(()=>validateNoticeManifest(duplicate,'fixture'),/duplicate coverage path/);
  const unresolvedFixture=clone(document);
  unresolvedFixture.externalSources[0]={module:'nvidia-libs/wine-nvml',path:'src/nvml_610.43.02.h',status:'unresolved',reason:'synthetic negative fixture'};
  assert.doesNotThrow(()=>validateNoticeManifest(unresolvedFixture,'fixture'));
  assert.throws(()=>planOf(unresolvedFixture),/unresolved external source must not be declared as a notice or context file/);
  const unresolvedClaim=clone(unresolvedFixture);
  unresolvedClaim.externalSources[0].commit='5b341a9e54f08ac324e148e1e7e102030e42b1c4';
  assert.throws(()=>validateNoticeManifest(unresolvedClaim,'fixture'),/must not claim a commit or a checksum/);
  const unresolvedHash=clone(unresolvedFixture);
  unresolvedHash.externalSources[0].sha256='31a26e3ce6f0b98a76cea38a3cf28aa112a20cfb37e9057786c768712d6a487f';
  assert.throws(()=>validateNoticeManifest(unresolvedHash,'fixture'),/must not claim a commit or a checksum/);
  const resolvedIncomplete=clone(document);
  delete resolvedIncomplete.externalSources[0].sha256;
  assert.throws(()=>validateNoticeManifest(resolvedIncomplete,'fixture'),/requires a 64 character sha256/);
  const resolvedMissingCommit=clone(document);
  delete resolvedMissingCommit.externalSources[0].commit;
  assert.throws(()=>validateNoticeManifest(resolvedMissingCommit,'fixture'),/requires a 40 character commit/);
  assert.doesNotThrow(()=>validateNoticeManifest(document,'fixture'));
});
test('actual pins and notice bytes match when private frozen inputs are available',t=>{
  const root=process.env.NEXUS_CACHYOS_NOTICE_INPUTS;
  if(!root){t.skip('set NEXUS_CACHYOS_NOTICE_INPUTS to a private frozen input root');return;}
  const document=readManifest();
  const fixture=nvmlHeaderFixture();
  let checked=0;
  for(const module of document.modules){
    const directory=path.join(root,module.path);
    const head=execFileSync('git',['-C',directory,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    assert.equal(head,module.commit,'HEAD differs from the declared pin: '+module.path);
    for(const file of [...module.notices,...(module.contextFiles??[])]){
      let bytes;
      if(module.path===nvmlModule&&file.path===nvmlExternalPath){
        assert.ok(fixture,'NVML_HEADER_FIXTURE is required for the resolved external header');
        bytes=fixture.bytes;
      }else{
        bytes=fs.readFileSync(path.join(directory,file.path));
      }
      assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,'hash differs: '+module.path+'/'+file.path);
      checked++;
    }
  }
  for(const [modulePath,commit] of Object.entries(excludedCommits)){
    let parent=null;
    for(const module of document.modules)if(modulePath.startsWith(module.path+'/')&&(!parent||module.path.length>parent.length))parent=module.path;
    assert.ok(parent,'no declared parent for excluded path '+modulePath);
    const relative=modulePath.slice(parent.length+1);
    assert.equal(gitlink(relative,path.join(root,parent)),commit,'excluded gitlink differs: '+modulePath);
  }
  const external=document.externalSources.find(entry=>entry.module===nvmlModule&&entry.path===nvmlExternalPath);
  assert.ok(external,'the NVML external source entry must exist');
  if(external.status==='resolved'){
    assert.ok(fixture,'NVML_HEADER_FIXTURE is required to verify the resolved header outside the pristine inputs');
    assert.equal(fixture.sha256,external.sha256);
    assert.equal(fixture.commit,external.commit);
    const notice=moduleOf(document,nvmlModule).notices.find(entry=>entry.path===nvmlExternalPath);
    assert.ok(notice,'resolved external header must also be a staged notice');
    assert.equal(notice.sha256,external.sha256);
  }else{
    assert.equal(external.status,'unresolved');
    assert.equal(external.commit,undefined);
    assert.equal(external.sha256,undefined);
  }
  assert.ok(checked>0);
});
test('the optional NVML header fixture matches the lock and only the declared external path',t=>{
  const fixture=nvmlHeaderFixture();
  if(!fixture){t.skip('set NVML_HEADER_FIXTURE to the exact immutable external header');return;}
  assert.equal(fixture.path,nvmlExternalPath);
  const external=readManifest().externalSources.find(entry=>entry.module===nvmlModule&&entry.path===nvmlExternalPath);
  assert.ok(external,'NVML external entry must be declared');
  if(external.status==='resolved'){
    assert.equal(fixture.sha256,external.sha256);
    assert.equal(fixture.commit,external.commit);
    const notice=moduleOf(readManifest(),nvmlModule).notices.find(entry=>entry.path===nvmlExternalPath);
    assert.ok(notice,'resolved external header must also be a staged notice');
    assert.equal(notice.sha256,external.sha256);
  }else{
    assert.equal(external.status,'unresolved');
    assert.equal(external.commit,undefined);
    assert.equal(external.sha256,undefined);
  }
});
test('the shipped NOTICE records the accepted SOIL DDS provenance',()=>{
  const notice=fs.readFileSync(path.join(project,'NOTICE'),'utf8');
  assert.match(notice,/SOIL/);
  assert.match(notice,/Public\s+Domain/i);
  assert.match(notice,/lonesock\.net/);
  assert.match(notice,/zlib/i);
  assert.doesNotMatch(notice,/\bcoding agent\b|\bAI\b|\btest diary\b/i);
});
test('the manifest records no source fetch, build or generated notice claims',()=>{
  const text=fs.readFileSync(manifestFile,'utf8');
  assert.doesNotMatch(text,/https?:\/\//);
  assert.doesNotMatch(text,/\bgenerated\b/i);
  assert.doesNotMatch(text,/resolved"\s*:\s*true/);
});

test('the Meson-linked dxbc-spirv dependency and its nested headers are declared modules',()=>{
  const document=readManifest();
  const dxbc=moduleOf(document,'extras/vkd3d-low-latency/subprojects/dxil-spirv/subprojects/dxbc-spirv');
  assert.equal(dxbc.commit,'8dae2d8573af08378c6059aca3d5987da99d20b5');
  assert.equal(dxbc.distribution,'linked');
  assert.ok(dxbc.notices.some(notice=>notice.path==='LICENSE'));
  const headers=moduleOf(document,'extras/vkd3d-low-latency/subprojects/dxil-spirv/subprojects/dxbc-spirv/submodules/spirv_headers');
  assert.equal(headers.commit,'c8ad050fcb29e42a2f57d9f59e97488f465c436d');
  assert.equal(headers.distribution,'linked');
  assert.ok(headers.notices.some(notice=>notice.path==='LICENSE'));
  assert.ok(headers.notices.some(notice=>notice.path==='LICENSES/MIT.txt'));
  assert.ok((headers.contextFiles??[]).some(file=>file.path==='LICENSES/CC-BY-4.0.txt'));
  assert.ok(!document.excluded.some(entry=>entry.path.endsWith('subprojects/dxbc-spirv')),'dxbc-spirv must not be excluded');
});
test('the NVOPTIX module stages its thirteen pinned headers as notices and keeps the README as context',()=>{
  const module=moduleOf(readManifest(),'nvidia-libs/wine-nvoptix');
  assert.equal(module.status,'ready');
  assert.equal((module.blockers??[]).length,0);
  const notices=new Map(module.notices.map(notice=>[notice.path,notice.sha256]));
  for(const path of ['AUTHORS','COPYING.LIB','LICENSE'])assert.ok(notices.has(path),'project notice missing: '+path);
  const staged=[...notices.keys()].filter(path=>path.startsWith('src/')).sort();
  assert.deepEqual(staged,Object.keys(nvoptixHeaders).sort());
  for(const [path,hash] of Object.entries(nvoptixHeaders))assert.equal(notices.get(path),hash,'pinned header hash changed: '+path);
  assert.equal(module.notices.length,16,'the module stages three project notices and thirteen headers');
  assert.deepEqual((module.contextFiles??[]).map(file=>file.path),['README.md']);
});
test('a missing or tampered NVOPTIX notice input fails closed against real pinned bytes',async t=>{
  const root=process.env.NEXUS_CACHYOS_NOTICE_INPUTS;
  if(!root){t.skip('set NEXUS_CACHYOS_NOTICE_INPUTS to a private frozen input root');return;}
  const module=moduleOf(readManifest(),'nvidia-libs/wine-nvoptix');
  const isolated={schema:1,kind:'source-notices',family:'nexus-cachyos',status:'ready',coverage:[module.path],modules:[module]};
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-nvoptix-notice-'));
  try{
    for(const file of [...module.notices,...(module.contextFiles??[])]){
      const target=path.join(scratch,module.path,file.path);
      fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(root,module.path,file.path),target);
    }
    const plan=sourceNoticePlan({manifests:[{file:'cachyos-module-notices.json',document:isolated}],inventory:[{path:module.path,commit:module.commit}]});
    const verified=await verifyNoticePlan({plan,sourceRoot:scratch});
    assert.equal(verified.notices.length,16);
    const header=path.join(scratch,module.path,'src/nvoptix_22.h');
    const bytes=fs.readFileSync(header);
    bytes[bytes.length-1]^=0xff;
    fs.writeFileSync(header,bytes);
    await assert.rejects(()=>verifyNoticePlan({plan,sourceRoot:scratch}),/sha256 does not match/);
    fs.copyFileSync(path.join(root,module.path,'src/nvoptix_22.h'),header);
    fs.rmSync(header);
    await assert.rejects(()=>verifyNoticePlan({plan,sourceRoot:scratch}),/declared file is missing/);
  }finally{
    fs.rmSync(scratch,{recursive:true,force:true});
  }
});
