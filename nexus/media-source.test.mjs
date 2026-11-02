// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {writeFileSync,copyFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileHash} from './ci/provenance.mjs';
import {fetchMediaSource} from './media-source.mjs';

async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-media-source-test-'));
  try{
    const archive='ffmpeg-4.4.8.tar.xz',bytes=Buffer.from('synthetic exact source archive');
    await fs.mkdir(root+'/media');await fs.writeFile(root+'/media/'+archive,bytes);
    const bundle=root+'/bundle.tar.xz';execFileSync('tar',['-cJf',bundle,'-C',root,'media/'+archive]);
    const lock={archive,url:'https://ffmpeg.org/releases/'+archive,sha256:await fileHash(root+'/media/'+archive),sourceBundle:{url:'https://github.com/domsvoboda/nexus-runtime/releases/download/runtime-11.0-20261028-ge5afe21e/nexus-runtime-11.0-experimental-ge5afe21e-source.tar.xz',sha256:await fileHash(bundle),member:'media/'+archive}};
    await run({root,bytes,bundle,lock,destination:root+'/download.tar.xz'});
    assert.ok(!(await fs.readdir(root)).some(name=>name.startsWith('.media-source-')),'owned scratch directory must be cleaned');
  }finally{await fs.rm(root,{recursive:true,force:true});}
}

test('successful upstream bytes retain HTTPS, bounded retry, checksum and exclusive destination',()=>fixture(async({lock,bytes,destination})=>{
  let calls=0;
  const execute=(command,args,options)=>{
    calls++;assert.equal(command,'curl');assert.equal(args.at(-1),lock.url);
    for(const flag of ['--proto','--proto-redir','--tlsv1.2','--connect-timeout','--max-time','--retry','--retry-max-time'])assert.ok(args.includes(flag));
    assert.ok(options.timeout>0&&options.timeout<=390000);assert.ok(!args.includes('--insecure'));
    writeFileSync(args[args.indexOf('--output')+1],bytes);
  };
  assert.deepEqual(await fetchMediaSource(lock,destination,{execute}),{url:lock.url,sha256:lock.sha256});
  assert.deepEqual(await fs.readFile(destination),bytes);assert.equal(calls,1);
  await assert.rejects(fetchMediaSource(lock,destination,{execute}),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(destination),bytes);
}));

test('failed partial upstream transfer uses only the pinned source member from a verified bundle',()=>fixture(async({root,lock,bytes,bundle,destination})=>{
  const execute=(command,args,options)=>{
    if(command==='tar')return execFileSync(command,args,options);
    const target=args[args.indexOf('--output')+1];
    if(args.at(-1)===lock.url){writeFileSync(target,'partial');throw Error('synthetic network reset');}
    assert.equal(args.at(-1),lock.sourceBundle.url);copyFileSync(bundle,target);
  };
  const result=await fetchMediaSource(lock,destination,{execute});
  assert.equal(result.member,lock.sourceBundle.member);assert.equal(result.memberSha256,lock.sha256);
  assert.deepEqual(await fs.readFile(destination),bytes);
  assert.equal(await fileHash(root+'/media/'+lock.archive),lock.sha256);
}));

test('completed upstream integrity failure is fatal, never hidden by a mirror',()=>fixture(async({lock,destination})=>{
  let calls=0;
  await assert.rejects(fetchMediaSource(lock,destination,{execute:(_,args)=>{calls++;writeFileSync(args[args.indexOf('--output')+1],'wrong bytes');}}),/archive checksum mismatch/);
  assert.equal(calls,1);await assert.rejects(fs.stat(destination),{code:'ENOENT'});
}));

test('both source-bundle and extracted-member digests are mandatory',async()=>{
  for(const corrupt of ['bundle','member'])await fixture(async({lock,bundle,destination})=>{
    if(corrupt==='bundle')lock.sourceBundle.sha256='0'.repeat(64);else lock.sha256='0'.repeat(64);
    const execute=(command,args,options)=>{
      if(command==='tar')return execFileSync(command,args,options);
      if(args.at(-1)===lock.url)throw Error('synthetic unavailability');
      copyFileSync(bundle,args[args.indexOf('--output')+1]);
    };
    await assert.rejects(fetchMediaSource(lock,destination,{execute}),/checksum mismatch/);
    await assert.rejects(fs.stat(destination),{code:'ENOENT'});
  });
});

test('untrusted URL, mutable release, cross-commit bundle and path traversal fail before network work',()=>fixture(async({lock,destination})=>{
  for(const mutate of [
    value=>value.url=value.url.replace('https:','http:'),
    value=>value.sourceBundle.url=value.sourceBundle.url.replace('runtime-11.0-20261028-ge5afe21e','latest'),
    value=>value.sourceBundle.url=value.sourceBundle.url.replace('experimental-ge5afe21e','experimental-g00000000'),
    value=>value.sourceBundle.member='../../'+value.archive,
  ]){
    const bad=structuredClone(lock);mutate(bad);
    await assert.rejects(fetchMediaSource(bad,destination,{execute:()=>assert.fail('must not fetch invalid pins')}),/Invalid pinned media/);
  }
}));
