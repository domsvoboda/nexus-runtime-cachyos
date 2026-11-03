// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {llvmMingwPin,fetchLlvmMingw} from './llvm-mingw.mjs';
const url='https://github.com/mstorsjo/llvm-mingw/releases/download/20261006/llvm-mingw-20261006-ucrt-ubuntu-22.04-aarch64.tar.xz';
const sha='e77c4acfa44184f6b0c52b814d724ad63b2ecebb3c3f6f842c0846e717cbd23c';
test('the llvm-mingw archive and its SHA-256 are both mandatory',()=>{
  assert.deepEqual({...llvmMingwPin({NEXUS_LLVM_MINGW_URL:url,NEXUS_LLVM_MINGW_SHA256:sha})},{url,sha256:sha,version:'20261006',directory:'llvm-mingw-20261006-ucrt-ubuntu-22.04-aarch64'});
  for(const env of [{},{NEXUS_LLVM_MINGW_URL:url},{NEXUS_LLVM_MINGW_SHA256:sha},{NEXUS_LLVM_MINGW_URL:url,NEXUS_LLVM_MINGW_SHA256:''},{NEXUS_LLVM_MINGW_URL:url,NEXUS_LLVM_MINGW_SHA256:sha.toUpperCase()},{NEXUS_LLVM_MINGW_URL:url,NEXUS_LLVM_MINGW_SHA256:sha.slice(1)},
    {NEXUS_LLVM_MINGW_URL:url.replace('https:','http:'),NEXUS_LLVM_MINGW_SHA256:sha},{NEXUS_LLVM_MINGW_URL:url.replace('mstorsjo','example'),NEXUS_LLVM_MINGW_SHA256:sha},
    {NEXUS_LLVM_MINGW_URL:url.replace('download/20261006','download/20261020'),NEXUS_LLVM_MINGW_SHA256:sha},{NEXUS_LLVM_MINGW_URL:url.replace('aarch64','x86_64'),NEXUS_LLVM_MINGW_SHA256:sha},
    {NEXUS_LLVM_MINGW_URL:url.replace('releases/download','releases/latest/download'),NEXUS_LLVM_MINGW_SHA256:sha}])assert.throws(()=>llvmMingwPin(env));
});
test('a wrong archive checksum fails before extraction',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-llvm-mingw-'));
  try{
    const archive=path.join(root,'other.tar.xz');await fs.writeFile(archive,'not the pinned toolchain');
    const pin=llvmMingwPin({NEXUS_LLVM_MINGW_URL:url,NEXUS_LLVM_MINGW_SHA256:sha});
    await assert.rejects(fetchLlvmMingw(path.join(root,'work'),pin,{archive}),/checksum mismatch/);
    assert.deepEqual(await fs.readdir(path.join(root,'work')),['llvm-mingw-20261006-ucrt-ubuntu-22.04-aarch64.tar.xz']);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
