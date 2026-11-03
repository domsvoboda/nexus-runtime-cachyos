import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {regularWithin,validatePortableElf} from './portable-elf.mjs';
import {libvaLock,libvaOptions} from './portable-libva.mjs';
test('cached dependency files reject identical external and intermediate symlinks',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'portable-dependency-'));
 try{
  const owned=path.join(root,'owned'),external=path.join(root,'external');await fs.mkdir(owned);await fs.mkdir(external);
  await fs.writeFile(path.join(external,'payload'),'identical bytes');await fs.writeFile(path.join(owned,'payload'),'identical bytes');
  assert.equal(await regularWithin(owned,path.join(owned,'payload')),path.join(owned,'payload'));
  await fs.symlink(path.join(external,'payload'),path.join(owned,'linked'));
  await assert.rejects(regularWithin(owned,path.join(owned,'linked')),/regular contained/);
  await fs.symlink(external,path.join(owned,'stage'));
  await assert.rejects(regularWithin(owned,path.join(owned,'stage/payload')),/regular contained/);
  await fs.symlink(owned,path.join(root,'alias'));
  await assert.rejects(regularWithin(path.join(root,'alias'),path.join(root,'alias/payload')),/canonical/);
  await assert.rejects(regularWithin(owned,path.join(external,'payload')),/escapes/);
 }finally{await fs.rm(root,{recursive:true});}
});
test('portable libva matches required FFmpeg ABI and never enables optional Wayland',async()=>{
 const lock=await libvaLock();assert.equal(lock.version,'2.22.0');assert.equal(lock.sha256,'e3da2250654c8d52b3f59f8cb3f3d8e7fb1a2ee64378dbc400fbc5663de7edb8');assert.deepEqual(Object.keys(lock.libraries),['libva.so.2','libva-drm.so.2','libva-x11.so.2']);
 assert.ok(libvaOptions.includes('-Dwith_wayland=no'));
 const elf={header:'Machine: Intel 80386',dynamic:'Library soname: [libva.so.2]\n(NEEDED) Shared library: [libc.so.6]',versions:'GLIBC_2.34'};
 assert.equal(validatePortableElf(elf,'i386-linux-gnu','libva.so.2',['libc.so.6']).maxGlibc,'2.34');
 assert.throws(()=>validatePortableElf({...elf,versions:'GLIBC_2.38'},'i386-linux-gnu','libva.so.2',['libc.so.6']));
});
