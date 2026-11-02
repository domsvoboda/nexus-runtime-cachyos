// SPDX-License-Identifier: MIT
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';
import {validateXml2Pin,verifyXml2Inventory} from './xml2-source.mjs';import {verifyInputs} from './inputs.mjs';import {sdkBuildPlan} from './sdk-build-plan.mjs';
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
