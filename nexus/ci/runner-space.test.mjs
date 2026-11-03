import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./runner-space.sh',import.meta.url)),repository=fileURLToPath(new URL('../../',import.meta.url));
async function fixture(fn){const root=await fs.mkdtemp(path.join(repository,'.runner-space-'));try{const calls=path.join(root,'calls'),bin=path.join(root,'bin');await fs.mkdir(bin);for(const [name,body]of Object.entries({docker:`require('fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify(['docker',...process.argv.slice(2)])+'\\n');if(process.argv[2]===process.env.TEST_DOCKER_FAIL)process.exit(1);if(process.argv[3]==='inspect'&&process.argv.at(-1)===process.env.TEST_ABSENT_IMAGE)process.exit(1);if(process.argv[2]==='image'&&process.argv[3]==='ls')console.log('registry.gitlab.steamos.cloud/proton/steamrt4/sdk/x86_64:keep sha256:sdk 10GB\\nexample.invalid/unrelated:keep sha256:other 1GB');if(process.argv[2]==='image'&&process.argv[3]==='inspect')console.log('sha256:fixture 123');if(process.argv[2]==='ps'&&process.env.TEST_CONTAINER)console.log('retained-container');`,sudo:`require('fs').appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');`,df:`console.log('Filesystem 1B-blocks Used Available Use% Mounted');console.log('disk 77309411328 1 '+process.env.TEST_FREE+' 1% /');`}))await fs.writeFile(path.join(bin,name),'#!'+process.execPath+'\n'+body,{mode:0o755});const env={...process.env,PATH:bin+':'+process.env.PATH,GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_TEMP:root,TEST_FREE:String(60*1024**3)};await fn({root,calls,env,run:(mode,extra={})=>spawnSync('bash',[script,mode],{env:{...env,...extra},encoding:'utf8'})});}finally{await fs.rm(root,{recursive:true,force:true});}}
test('dry run never invokes deletion and reports fixed unused SDK allowlist',()=>fixture(async f=>{assert.equal(f.run('--dry-run').status,0);await assert.rejects(fs.stat(f.calls),{code:'ENOENT'});}));
test('apply is hosted-only and never deletes live build paths or the whole tool cache',()=>fixture(async f=>{assert.notEqual(f.run('--prepare',{RUNNER_ENVIRONMENT:'self-hosted'}).status,0);await assert.rejects(fs.stat(f.calls),{code:'ENOENT'});assert.equal(f.run('--prepare').status,0);const rows=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse),rm=rows.find(r=>r[0]==='rm');assert.ok(rm);assert.deepEqual(rm.slice(0,3),['rm','-rf','--']);for(const value of [f.root,'/opt/hostedtoolcache','/var/lib/docker','/home/runner/work'])assert.ok(!rm.includes(value));for(const value of ['/usr/local/swift','/usr/lib/jvm','/opt/hostedtoolcache/CodeQL','/opt/hostedtoolcache/Python','/opt/hostedtoolcache/go','/opt/hostedtoolcache/PyPy','/opt/hostedtoolcache/Ruby','/opt/google/chrome','/opt/microsoft/msedge','/usr/local/share/chromium'])assert.ok(rm.includes(value));}));
test('space check fails closed below 35 GiB and performs no deletion',()=>fixture(async f=>{assert.notEqual(f.run('--check',{TEST_FREE:String(22*1024**3)}).status,0);assert.equal(f.run('--check').status,0);await assert.rejects(fs.stat(f.calls),{code:'ENOENT'});}));
test('cleanup precedes recursive checkout, headroom precedes compile and archive removal follows extraction',async()=>{const text=await fs.readFile(path.join(repository,'.github/workflows/nexus-runtime.yml'),'utf8'),runtime=text.slice(text.indexOf('  runtime:'));assert.ok(runtime.indexOf('runner-space.sh --prepare')<runtime.indexOf('initialize-source.mjs --initialize'));assert.ok(runtime.indexOf('runner-space.sh --check')<runtime.indexOf('id: compile\n'));assert.match(runtime,/tar -xJf "\$RUNNER_TEMP\/auxiliary.tar.xz"[^\n]*\n\s+rm -- "\$RUNNER_TEMP\/auxiliary.tar.xz"/);});

test('preparation reserves measured source setup separately from unchanged compile reserve',()=>fixture(async f=>{
  for(const [mode,bytes,ok] of [['--prepare',48*1024**3,true],['--prepare',48*1024**3-1,false],['--check',35*1024**3,true],['--check',35*1024**3-1,false]]){
    assert.equal(f.run(mode,{TEST_FREE:String(bytes)}).status===0,ok,mode+' '+bytes);
  }
}));
test('stage reports diagnose low space without deletion or hiding the failing compile status',()=>fixture(async f=>{
  const result=f.run('--report',{TEST_FREE:'1'});assert.equal(result.status,0);assert.match(result.stdout,/Disk stage: --report/);await assert.rejects(fs.stat(f.calls),{code:'ENOENT'});
}));
test('active interpreter inside unused toolcache fails before any deletion',()=>fixture(async f=>{
  await fs.writeFile(path.join(f.root,'bin','readlink'),'#!/bin/sh\necho /opt/hostedtoolcache/Python/3/bin/python3\n',{mode:0o755});
  const result=f.run('--prepare');assert.notEqual(result.status,0);assert.match(result.stderr,/Active interpreter/);await assert.rejects(fs.stat(f.calls),{code:'ENOENT'});
}));

test('preloaded image cleanup removes only fixed named refs and retains container dependencies',()=>fixture(async f=>{
  assert.equal(f.run('--prepare').status,0);
  let rows=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
  let removed=rows.filter(r=>r[0]==='docker'&&r[1]==='image'&&r[2]==='rm');assert.equal(removed.length,6);
  for(const row of removed){assert.deepEqual(row.slice(0,4),['docker','image','rm','--']);assert.match(row[4],/^ghcr\.io\/(?:github|dependabot)\//);assert.ok(!row.includes('-f'));}
  assert.ok(rows.every(r=>!r.includes('prune')));
  await fs.unlink(f.calls);assert.equal(f.run('--prepare',{TEST_CONTAINER:'yes'}).status,0);
  rows=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!rows.some(r=>r[0]==='docker'&&r[2]==='rm'));
}));

test('failed container enumeration never removes an image or uses forced cleanup',()=>fixture(async f=>{
  assert.notEqual(f.run('--prepare',{TEST_DOCKER_FAIL:'ps'}).status,0);
  const rows=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(rows.some(r=>r[0]==='docker'&&r[1]==='ps'&&r.includes('-aq')));
  assert.ok(!rows.some(r=>r[0]==='docker'&&r[2]==='rm'));
}));

test('absent preloaded tag is not pulled or removed',()=>fixture(async f=>{
  const missing='ghcr.io/github/gh-aw-mcpg:latest';
  assert.equal(f.run('--prepare',{TEST_ABSENT_IMAGE:missing}).status,0);
  const rows=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!rows.some(r=>r[0]==='docker'&&r[2]==='rm'&&r.includes(missing)));
  assert.equal(rows.filter(r=>r[0]==='docker'&&r[2]==='rm').length,5);
  assert.ok(rows.every(r=>!r.includes('pull')));
}));
