// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {makeSdkLinksPortable} from './runtime-copy.mjs';
test('portable prefix links bind bundled bytes without mutating the SDK target',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-'));
  try{
    const sdk=path.join(root,'sdk'),runtime=path.join(root,'runtime');
    await fs.mkdir(path.join(sdk,'redist/files/lib'),{recursive:true});
    await fs.mkdir(path.join(runtime,'files/lib'),{recursive:true});
    await fs.mkdir(path.join(runtime,'prefix'),{recursive:true});
    await fs.writeFile(path.join(sdk,'redist/files/lib/module.dll'),'same');
    await fs.writeFile(path.join(runtime,'files/lib/module.dll'),'same');
    await fs.writeFile(path.join(sdk,'generated.nls'),'nls');
    await fs.symlink(path.join(sdk,'redist/files/lib/module.dll'),path.join(runtime,'prefix/module.dll'));
    await fs.symlink(path.join(sdk,'generated.nls'),path.join(runtime,'prefix/table.nls'));
    const proof=await makeSdkLinksPortable(runtime,sdk);
    assert.equal(proof.relative,1);assert.equal(proof.materialized,1);
    assert.equal(await fs.readlink(path.join(runtime,'prefix/module.dll')),'../files/lib/module.dll');
    assert.equal(await fs.readFile(path.join(runtime,'prefix/table.nls'),'utf8'),'nls');
    assert.equal(await fs.readFile(path.join(sdk,'redist/files/lib/module.dll'),'utf8'),'same');
    await fs.writeFile(path.join(sdk,'redist/files/lib/module.dll'),'later SDK change');
    assert.equal(await fs.readFile(path.join(runtime,'prefix/module.dll'),'utf8'),'same');
  }finally{await fs.rm(root,{recursive:true});}
});
test('external directories and files cannot become runtime dependencies',async()=>{
  for(const directory of [false,true]){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-deny-'));
    try{
      const sdk=path.join(root,'sdk'),runtime=path.join(root,'runtime'),foreign=path.join(root,'foreign');
      await fs.mkdir(sdk);await fs.mkdir(runtime);
      if(directory)await fs.mkdir(foreign);else await fs.writeFile(foreign,'private fixture');
      await fs.symlink(foreign,path.join(runtime,'foreign'));
      await assert.rejects(()=>makeSdkLinksPortable(runtime,sdk),/not an SDK file/);
      assert.equal(await fs.readlink(path.join(runtime,'foreign')),foreign);
    }finally{await fs.rm(root,{recursive:true});}
  }
});
test('only the standard default-prefix Z drive mapping may point at root',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-drive-'));
  try{
    const sdk=path.join(root,'sdk'),runtime=path.join(root,'runtime');await fs.mkdir(sdk);
    const devices=path.join(runtime,'files/share/default_pfx/dosdevices');await fs.mkdir(devices,{recursive:true});
    await fs.symlink('/',path.join(devices,'z:'));
    assert.equal((await makeSdkLinksPortable(runtime,sdk)).prefixDriveMappings,1);
    await fs.symlink('/',path.join(runtime,'unexpected'));
    await assert.rejects(()=>makeSdkLinksPortable(runtime,sdk),/not an SDK file/);
  }finally{await fs.rm(root,{recursive:true});}
});
test('relative links cannot escape through the default Z drive',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-chain-'));
  try{
    const sdk=path.join(root,'sdk'),runtime=path.join(root,'runtime');await fs.mkdir(sdk);
    const devices=path.join(runtime,'files/share/default_pfx/dosdevices');await fs.mkdir(devices,{recursive:true});
    await fs.symlink('/',path.join(devices,'z:'));
    await fs.symlink('files/share/default_pfx/dosdevices/z:/etc/passwd',path.join(runtime,'unexpected'));
    await assert.rejects(()=>makeSdkLinksPortable(runtime,sdk),/not an SDK file/);
  }finally{await fs.rm(root,{recursive:true});}
});
test('a prefix cannot silently retain different SDK and bundled module bytes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-portable-mismatch-'));
  try{
    const sdk=path.join(root,'sdk'),runtime=path.join(root,'runtime');
    await fs.mkdir(path.join(sdk,'redist/files/lib'),{recursive:true});await fs.mkdir(path.join(runtime,'files/lib'),{recursive:true});
    await fs.writeFile(path.join(sdk,'redist/files/lib/module.dll'),'sdk');await fs.writeFile(path.join(runtime,'files/lib/module.dll'),'different');
    await fs.symlink(path.join(sdk,'redist/files/lib/module.dll'),path.join(runtime,'prefix.dll'));
    await assert.rejects(()=>makeSdkLinksPortable(runtime,sdk),/disagrees with bundled bytes/);
    assert.equal(await fs.readFile(path.join(runtime,'files/lib/module.dll'),'utf8'),'different');
  }finally{await fs.rm(root,{recursive:true});}
});
