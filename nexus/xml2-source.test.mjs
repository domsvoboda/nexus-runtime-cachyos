// SPDX-License-Identifier: MIT
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {validateXml2Pin,verifyXml2Inventory,verifyXml2Source} from './xml2-source.mjs';import {verifyInputs} from './inputs.mjs';import {sdkBuildPlan} from './sdk-build-plan.mjs';
const {inputs}=await verifyInputs();
test('strict parser identity and make argument cannot select arbitrary sources',()=>{
 validateXml2Pin(inputs.xml2Source);
 for(const mutate of [p=>p.commit='main',p=>p.repository='other/parser',p=>p.tree='0'.repeat(40),p=>p.subtree='../parser']){const pin=structuredClone(inputs.xml2Source);mutate(pin);assert.throws(()=>validateXml2Pin(pin));}
 assert.ok(sdkBuildPlan('/work/sdk-build','1',16,undefined,'x86_64','/work/xgr-xml2-source').every(stage=>stage.args.includes('NEXUS_XML2_SOURCE=/work/xgr-xml2-source')));
 assert.throws(()=>sdkBuildPlan('/work/sdk-build','1',16,undefined,'x86_64','/other/parser'));
});
test('strict source inventory rejects changed, missing, extra and redirected files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-xml-inventory-'));
 try{const bytes=Buffer.from('strict parser'),files={'parser.c':createHash('sha256').update(bytes).digest('hex')};await fs.writeFile(path.join(root,'parser.c'),bytes);await verifyXml2Inventory(root,files);
 await fs.appendFile(path.join(root,'parser.c'),'changed');await assert.rejects(verifyXml2Inventory(root,files));await fs.writeFile(path.join(root,'parser.c'),bytes);
 await fs.writeFile(path.join(root,'extra'),'new');await assert.rejects(verifyXml2Inventory(root,files));await fs.unlink(path.join(root,'extra'));
 await fs.unlink(path.join(root,'parser.c'));await assert.rejects(verifyXml2Inventory(root,files));await fs.symlink('/etc/passwd',path.join(root,'parser.c'));await assert.rejects(verifyXml2Inventory(root,files));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('strict XML metadata rejects identical external JSON and redirected ancestors',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-xml-metadata-'));
 try{
  const work=path.join(root,'work'),directory=path.join(work,'xgr-xml2-source');await fs.mkdir(directory,{recursive:true});
  const names=['parser.c','COPYING','AUTHORS',...Array.from({length:96},(_,n)=>'file-'+n)],files={};
  for(const name of names){const bytes=Buffer.from('fixture:'+name);files[name]=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(path.join(directory,name),bytes);}
  const lock=Buffer.from(JSON.stringify({files})),lockFile=path.join(root,'lock.json');await fs.writeFile(lockFile,lock);
  const pin={...inputs.xml2Source,lockSha256:createHash('sha256').update(lock).digest('hex')};
  const manifest=path.join(work,'xgr-xml2-source.json'),outside=path.join(root,'outside.json');
  const metadata=JSON.stringify({schema:1,identity:pin,files,licenses:{COPYING:files.COPYING,AUTHORS:files.AUTHORS}});
  await fs.writeFile(manifest,metadata);await verifyXml2Source(work,pin,lockFile);
  await fs.rename(manifest,outside);await fs.symlink(outside,manifest);await assert.rejects(verifyXml2Source(work,pin,lockFile),/provenance redirected/);
  await fs.unlink(manifest);await fs.rename(outside,manifest);const alias=path.join(root,'alias');await fs.symlink(work,alias);await assert.rejects(verifyXml2Source(alias,pin,lockFile),/provenance redirected/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
