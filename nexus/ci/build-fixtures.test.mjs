// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const script=fileURLToPath(new URL('./build-fixtures.mjs',import.meta.url));
const inputs=JSON.parse(await fs.readFile(new URL('../inputs.lock.json',import.meta.url),'utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'fixture-xml-'));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const prepared=path.join(root,'prepared'),source=path.join(root,'source'),xml=path.join(prepared,'xgr-xml2-source');
 const cmake=path.join(source,'wine/dlls/xgameruntime/cmake'),bin=path.join(root,'bin');
 for(const p of [xml,cmake,bin])await fs.mkdir(p,{recursive:true});
 const files={};for(const name of ['parser.c','COPYING','AUTHORS',...Array.from({length:96},(_,i)=>'file-'+i)]){
  const bytes='fixture:'+name;files[name]=sha(bytes);await fs.writeFile(path.join(xml,name),bytes);
 }
 const lock=JSON.stringify({files}),pin={...inputs.xml2Source,lockSha256:sha(lock)};
 await fs.writeFile(path.join(cmake,'xml2.lock.json'),lock);
 await fs.writeFile(path.join(prepared,'xgr-xml2-source.json'),JSON.stringify({schema:1,identity:pin,files,licenses:{COPYING:files.COPYING,AUTHORS:files.AUTHORS}}));
 const calls=path.join(root,'calls.jsonl');
 // Capture actual production invocations; stop after both ABI configure/build pairs.
 await fs.writeFile(path.join(bin,'podman'),`#!${process.execPath}\nconst fs=require('node:fs');fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(process.argv.slice(2))+'\\n');if(fs.readFileSync(${JSON.stringify(calls)},'utf8').trim().split('\\n').length===4){console.error('fixture-capture-complete');process.exit(77);}\n`,{mode:0o755});
 const built={metadata:{targetArchitecture:'x86_64'},inputs:{sdk:inputs.sdk,xml2Source:pin},graph:{xml2Source:pin},source,prepared,runtime:path.join(root,'runtime')};
 async function run(){
  await fs.writeFile(path.join(root,'built.json'),JSON.stringify(built));
  const result=spawnSync(process.execPath,[script,root,path.join(root,'fixtures')],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,NEXUS_CONTAINER_ENGINE:'podman'}});
  const argv=await fs.readFile(calls,'utf8').then(x=>x.trim().split('\n').map(x=>JSON.parse(x)),e=>{if(e.code==='ENOENT')return [];throw e;});
  return {result,argv};
 }
 return {root,prepared,xml,built,run};
}
for(const strict of [true,false])test(`actual fixture SDK commands preserve both ABI XML selection (strict=${strict})`,async t=>{
 const f=await fixture(t);if(!strict){delete f.built.inputs.xml2Source;delete f.built.graph.xml2Source;}
 const {result,argv}=await f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/fixture-capture-complete/);assert.equal(argv.length,4);
 for(const [i,args]of argv.entries()){
  assert.equal(args.includes(`type=bind,src=${f.xml},dst=/xml2-source,readonly`),strict);
  assert.ok(args.includes('/fixtures/'+(i<2?'win64':'win32')));
  assert.ok(args.includes('--network=none'));
  if(i%2===0){assert.equal(args.includes('-DNEXUS_XML2_SOURCE=/xml2-source'),strict);assert.ok(args.includes('-DENABLE_TESTS=ON'));}
 }
});
for(const problem of ['bytes','provenance-link','graph'])test(`fixture XML ${problem} fails before SDK or fixture creation`,async t=>{
 const f=await fixture(t);
 if(problem==='bytes')await fs.appendFile(path.join(f.xml,'parser.c'),'changed');
 if(problem==='provenance-link'){
  const manifest=path.join(f.prepared,'xgr-xml2-source.json'),outside=path.join(f.root,'outside.json');await fs.rename(manifest,outside);await fs.symlink(outside,manifest);
 }
 if(problem==='graph')f.built.graph.xml2Source={...f.built.inputs.xml2Source,commit:'0'.repeat(40)};
 const {result,argv}=await f.run();assert.notEqual(result.status,0);assert.match(result.stderr,/Strict XML source bytes changed|Strict XML provenance redirected|Fixture XML source graph mismatch/);assert.deepEqual(argv,[]);
 await assert.rejects(fs.stat(path.join(f.root,'fixtures')),{code:'ENOENT'});
});
