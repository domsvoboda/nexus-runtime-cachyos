// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareValidationTools,validationProcessOutput} from './validation-tools.mjs';

async function fixture(run){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-validation-tools-'));
  try{
    const files=root+"/candidate 'quoted\nname/files",bin=files+'/bin';
    await fs.mkdir(bin,{recursive:true});
    for(const name of ['wine','wineserver'])await fs.writeFile(bin+'/'+name,
      '#!/bin/sh\nprintf "%s\\n" "'+name+'" "$@" > "$TRACE"\nexit "${RESULT:-0}"\n',{mode:0o700});
    await run({root,files,bin});
  }finally{await fs.rm(root,{recursive:true});}
}

test('bare wineboot missing on a clean runner reproduces ENOENT before staging',async()=>fixture(async({root})=>{
  const empty=root+'/empty';await fs.mkdir(empty);
  const r=spawnSync('wineboot',['--init'],{env:{PATH:empty},encoding:'utf8'});
  assert.equal(r.error?.code,'ENOENT');assert.equal(r.stdout,undefined);
}));

test('all Wine commands use the exact candidate even with poisoned host commands',async()=>fixture(async({root,files})=>{
  const host=root+'/host',tools=root+'/tools',trace=root+'/trace';await fs.mkdir(host);
  for(const command of ['wine','wineboot','wineserver'])await fs.writeFile(host+'/'+command,'#!/bin/sh\nexit 93\n',{mode:0o700});
  await prepareValidationTools(files,tools);
  for(const [command,args,expected]of [
    ['wineboot',['--init'],['wine','wineboot.exe','--init']],
    ['wine',["a file's name.exe",'arg\nnext'],['wine',"a file's name.exe",'arg\nnext']],
    ['wineserver',['-w'],['wineserver','-w']],
  ]){
    const r=spawnSync(command,args,{env:{PATH:tools+':'+host,TRACE:trace},encoding:'utf8'});
    assert.equal(r.status,0,validationProcessOutput(r));
    assert.equal(await fs.readFile(trace,'utf8'),expected.join('\n')+'\n');
    assert.equal((await fs.stat(tools+'/'+command)).mode&0o777,0o700);
  }
  const failure=spawnSync('wineboot',['--init'],{env:{PATH:tools+':'+host,TRACE:trace,RESULT:'17'},encoding:'utf8'});
  assert.equal(failure.status,17,'candidate errors must not fall back to host Wine');
}));

test('candidate commands are required and an existing tool directory is never overwritten',async()=>fixture(async({root,files,bin})=>{
  const tools=root+'/tools';await prepareValidationTools(files,tools);
  const before=await fs.readFile(tools+'/wineboot');
  await assert.rejects(prepareValidationTools(files,tools),{code:'EEXIST'});
  assert.deepEqual(await fs.readFile(tools+'/wineboot'),before);
  await fs.unlink(bin+'/wineserver');
  await assert.rejects(prepareValidationTools(files,root+'/missing'),{code:'ENOENT'});
  await assert.rejects(fs.stat(root+'/missing'),{code:'ENOENT'});
}));

test('spawn failures, timeouts and signals retain actionable evidence',()=>{
  const missing=Object.assign(new Error('spawn wineboot ENOENT'),{code:'ENOENT'});
  assert.match(validationProcessOutput({status:null,signal:null,error:missing}),/status=null signal=none error=ENOENT/);
  assert.match(validationProcessOutput({stdout:'partial',status:null,signal:'SIGTERM',error:Object.assign(new Error('timeout'),{code:'ETIMEDOUT'})}),/^partial\nPROCESS .*SIGTERM.*ETIMEDOUT/);
  assert.match(validationProcessOutput({stdout:'',stderr:'failure\n',status:7,signal:null}),/^failure\nPROCESS status=7/);
  assert.equal(validationProcessOutput({stdout:'passed\n',stderr:'',status:0,signal:null}),'passed\n');
});
