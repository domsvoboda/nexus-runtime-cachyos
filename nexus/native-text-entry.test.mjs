// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stageNativeTextEntry} from './native-text-entry.mjs';
const target={primaryPe:'x86_64',prefix:'default_pfx'};
function pe(arch){const bytes=Buffer.alloc(128);bytes.writeUInt16LE(0x5a4d,0);bytes.writeUInt32LE(64,60);bytes.writeUInt32LE(0x4550,64);bytes.writeUInt16LE(arch==='i386'?0x14c:arch==='aarch64'?0xaa64:0x8664,68);return bytes;}

async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-native-entry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('older pinned components remain unchanged when no helper was built',async t=>{
  const root=await fixture(t);assert.equal(await stageNativeTextEntry(root,target),null);
  assert.deepEqual(await fs.readdir(root),[]);
});
test('helper bytes staged from the matching architecture have an auditable checksum',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(source,{recursive:true});
  const content=Buffer.from('# SPDX-License-Identifier: LGPL-2.1-or-later\nprint("fixture")\n');await fs.writeFile(path.join(source,'nexus-text-entry.py'),content);await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),pe('x86_64'));
  const result=await stageNativeTextEntry(root,target);
  assert.equal(result.sha256,createHash('sha256').update(content).digest('hex'));
  assert.equal(result.gameplayValidated,false);
  assert.deepEqual(await fs.readFile(path.join(root,'share/default_pfx/drive_c/windows/system32/nexus-text-entry.py')),content);
  assert.equal((await fs.stat(path.join(root,'share/default_pfx/drive_c/windows/system32/nexus-text-entry.py'))).mode&0o777,0o644);
});
test('invalid targets and unreasonable helpers fail closed',async t=>{
  const root=await fixture(t);
  await assert.rejects(stageNativeTextEntry(root,{...target,prefix:'../../host'}),/Invalid/);
  await assert.rejects(stageNativeTextEntry(root,{...target,primaryPe:'../host'}),/Invalid/);
  const directory=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(directory,{recursive:true});
  await fs.writeFile(path.join(directory,'nexus-text-entry.py'),Buffer.alloc(256*1024+1));
  await assert.rejects(stageNativeTextEntry(root,target),/size/);
});
test('Proton updates existing game prefixes as well as new defaults',async()=>{
  const {spawnSync}=await import('node:child_process');
  const result=spawnSync('python3',[new URL('./test_native_text_entry_prefix.py',import.meta.url).pathname],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.stdout);
});

test('an incomplete component pair fails before prefix output is written',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'nexus-text-entry.py'),'fixture');
  await assert.rejects(stageNativeTextEntry(root,target),/ENOENT/);
  await assert.rejects(fs.access(path.join(root,'share')));
});
test('WOW64 uses its own matching PE bridge with the same Python bytes',async t=>{
  const root=await fixture(t);
  for(const arch of ['x86_64','i386']){
    const source=path.join(root,'lib/wine',arch+'-windows');await fs.mkdir(source,{recursive:true});
    await fs.writeFile(path.join(source,'nexus-text-entry.py'),'shared Python fixture');
    await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),pe(arch));
  }
  const result=await stageNativeTextEntry(root,{...target,peArchitectures:['x86_64','i386']});
  for(const [arch,dir]of [['x86_64','system32'],['i386','syswow64']]){
    const bridge=await fs.readFile(path.join(root,'share/default_pfx/drive_c/windows',dir,'nexus-text-entry-host.exe'));
    assert.deepEqual(bridge,pe(arch));
    assert.equal(result.bridgeSha256[arch],createHash('sha256').update(bridge).digest('hex'));
  }
});

test('a mislabelled bridge architecture is rejected before prefix writes',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'nexus-text-entry.py'),'fixture');
  await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),pe('i386'));
  await assert.rejects(stageNativeTextEntry(root,target),/architecture/);
  await assert.rejects(fs.access(path.join(root,'share')));
});

test('the CachyOS ARM64 target never receives the x86_64-only helper',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/aarch64-windows');await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'nexus-text-entry.py'),'fixture');
  await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),pe('aarch64'));
  assert.equal(await stageNativeTextEntry(root,{...target,primaryPe:'aarch64',prefix:'default_pfx_arm64',peArchitectures:['aarch64','x86_64','i386']}),null);
  await assert.rejects(fs.access(path.join(root,'share')));
});

test('the measured 2.6 MB SDK bridge is accepted and an excessive bridge rejected',async t=>{
  const root=await fixture(t),source=path.join(root,'lib/wine/x86_64-windows');await fs.mkdir(source,{recursive:true});
  await fs.writeFile(path.join(source,'nexus-text-entry.py'),'fixture');
  const measured=2_674_278,bridge=Buffer.concat([pe('x86_64'),Buffer.alloc(measured-128,0x20)]);
  await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),bridge);
  const result=await stageNativeTextEntry(root,target);
  const staged=path.join(root,'share/default_pfx/drive_c/windows/system32/nexus-text-entry-host.exe');
  assert.equal((await fs.stat(staged)).size,measured);
  assert.equal(result.bridgeSha256.x86_64,createHash('sha256').update(bridge).digest('hex'));
  const excessive=Buffer.concat([pe('x86_64'),Buffer.alloc(4*1024*1024,0x20)]);
  await fs.writeFile(path.join(source,'nexus-text-entry-host.exe'),excessive);
  await assert.rejects(stageNativeTextEntry(root,target),/size|architecture/);
  assert.equal((await fs.stat(staged)).size,measured);
});
