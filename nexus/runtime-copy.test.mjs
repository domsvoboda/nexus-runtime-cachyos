// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {copySdkRedistribution} from './runtime-copy.mjs';
test('prefix links stay portable and independent of later SDK output',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'runtime-copy-'));
  try {
    const source=path.join(root,'sdk'),target=path.join(root,'candidate');
    await fs.mkdir(path.join(source,'files/lib'),{recursive:true});await fs.mkdir(path.join(source,'files/prefix'));
    await fs.writeFile(path.join(source,'files/lib/concrt140.dll'),'old');
    await fs.symlink('../lib/concrt140.dll',path.join(source,'files/prefix/concrt140.dll'));
    await copySdkRedistribution(source,target);
    assert.equal(await fs.readlink(path.join(target,'files/prefix/concrt140.dll')),'../lib/concrt140.dll');
    await fs.writeFile(path.join(source,'files/lib/concrt140.dll'),'changed SDK');
    assert.equal(await fs.readFile(path.join(target,'files/prefix/concrt140.dll'),'utf8'),'old');
    const moved=path.join(root,'moved');await fs.rename(target,moved);await fs.rm(source,{recursive:true});
    assert.equal(await fs.readFile(path.join(moved,'files/prefix/concrt140.dll'),'utf8'),'old');
    const other=path.join(root,'other');await fs.mkdir(other);await fs.writeFile(path.join(other,'file'),'existing');
    await fs.mkdir(source);await fs.writeFile(path.join(source,'file'),'replacement');
    await assert.rejects(copySdkRedistribution(source,other));
    assert.equal(await fs.readFile(path.join(other,'file'),'utf8'),'existing');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
