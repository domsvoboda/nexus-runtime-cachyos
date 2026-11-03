// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readJson,sourceEnvironment,verifyInputs} from '../inputs.mjs';
import {fileHash,treeHash,assertPortable,validateGateResults} from './provenance.mjs';
import {verifyXml2Source} from '../xml2-source.mjs';
import {sourceArchiveArgs} from './source-archive.mjs';
import {distributionIdentity,distributionName} from './distribution-identity.mjs';
import {verifyPortableGlib} from '../portable-glib.mjs';
import {verifyPortableLibva} from '../portable-libva.mjs';
const {inputs:packagingInputs}=await verifyInputs();
const identity=distributionIdentity(packagingInputs);
const [outputArg,validationArg]=process.argv.slice(2);
if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_REPOSITORY!==identity.repository||!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA||'')||!/^\d+$/.test(process.env.GITHUB_RUN_ID||''))throw Error('Packaging requires an exact main GitHub runtime build');
if(!outputArg||!validationArg||process.argv.length!==4)throw Error('BUILD_OUTPUT VALIDATION required');
const output=await fs.realpath(outputArg),validation=await fs.realpath(validationArg);
const built=await readJson(output+'/built.json'),proof=await readJson(validation+'/results.json');
if(JSON.stringify(built.inputs.xml2Source)!==JSON.stringify(packagingInputs.xml2Source)||JSON.stringify(built.graph.xml2Source)!==JSON.stringify(packagingInputs.xml2Source))throw Error('Strict XML packaging identity changed');
if(built.diagnosticOnly||built.promotable===false||built.metadata.diagnosticOnly||built.metadata.promotable===false||built.graph.proton!==process.env.GITHUB_SHA||built.name!==distributionName(packagingInputs,process.env.GITHUB_SHA)||path.dirname(built.runtime)!==output||path.basename(built.runtime)!==built.name)throw Error('Not the exact main distribution source');
if(proof.passed!==true||proof.stableApproved!==false||proof.realGameTest!==false||proof.realAccountTest!==false||proof.realCloudTest!==false||proof.builtSha256!==await fileHash(output+'/built.json')||proof.treeSha256!==await treeHash(built.runtime)||JSON.stringify(proof.graph)!==JSON.stringify(built.graph))throw Error('Unvalidated or changed runtime');
validateGateResults(proof.results);await assertPortable(built.runtime);
for(const r of proof.results){if(!r.log.startsWith(validation+'/')||await fileHash(r.log)!==r.sha256)throw Error('Changed native log');}
for(const [relative,expected]of Object.entries(proof.bindings)){
  const file=path.resolve(validation,relative);if(!file.startsWith(validation+'/')||!(await fs.realpath(file)).startsWith(validation+'/')||await fileHash(file)!==expected)throw Error('Changed native result');
}
if(execFileSync('git',['rev-parse','HEAD'],{cwd:built.source,encoding:'utf8'}).trim()!==process.env.GITHUB_SHA)throw Error('Corresponding source moved');
if(built.inputs.xml2Source){
 if(JSON.stringify(built.graph.xml2Source)!==JSON.stringify(built.inputs.xml2Source))throw Error('Strict XML source graph changed');
 await verifyXml2Source(built.prepared,built.inputs.xml2Source,built.source+'/wine/dlls/xgameruntime/cmake/xml2.lock.json');
}
const media=await readJson(built.aux+'/media/media-manifest.json');
if(await fileHash(built.aux+'/media/ffmpeg-'+media.version+'.tar.xz')!==media.sourceSha256)throw Error('Corresponding FFmpeg source changed');
if(built.inputs.variant?.family==='nexus-cachyos'){await verifyPortableGlib(built.aux+'/portable-glib');await verifyPortableLibva(built.aux+'/portable-libva');}
const env={...sourceEnvironment(),XZ_OPT:'-T2'};
function tar(args){execFileSync('tar',args,{env,stdio:'inherit',timeout:20*60*1000});}
const binary=built.name+'-x86_64.tar.xz',source=built.name+'-source.tar.xz';
for(const name of [binary,source,'candidate.json'])try{await fs.access(output+'/'+name);throw Error('Do not replace an existing candidate');}catch(e){if(e.code!=='ENOENT')throw e;}
tar(['-cJf',output+'/'+binary,'-C',output,built.name]);
tar(sourceArchiveArgs(output+'/'+source,built.source,built.aux,built.prepared,media.version,Boolean(built.inputs.xml2Source),built.inputs.variant?.family==='nexus-cachyos'));
const listing=execFileSync('tar',['-tJf',output+'/'+source],{encoding:'utf8',maxBuffer:32*1024*1024,timeout:120000}).trim().split('\n');
if(listing.some(n=>path.isAbsolute(n)||n.split('/').some(v=>v==='..'||v==='.git'))||!listing.includes('source/.gitmodules')||!listing.includes('source/wine/dlls/xgameruntime/CMakeLists.txt')||!listing.includes('source/nexus/licenses/GCC-runtime-copyright')||!listing.includes('source-module-plan.json'))throw Error('Corresponding source archive incomplete');
if(built.inputs.variant?.family==='nexus-cachyos'&&!['portable-glib/glib-2.84.4.tar.xz','portable-glib/manifest.json','portable-glib/COPYING','portable-libva/libva-2.22.0.tar.bz2','portable-libva/manifest.json','portable-libva/COPYING'].every(name=>listing.includes(name)))throw Error('Portable GLib corresponding source missing');
if(built.inputs.xml2Source&&!['xgr-xml2-source/parser.c','xgr-xml2-source/COPYING','xgr-xml2-source/AUTHORS','xgr-xml2-source.json'].every(name=>listing.includes(name)))throw Error('Strict XML corresponding source missing');
const files=[];
for(const name of [binary,source]){
  const checksum=name.replace(/\.tar\.xz$/,'.sha512sum');
  await fs.writeFile(output+'/'+checksum,await fileHash(output+'/'+name,'sha512')+'  '+name+'\n',{flag:'wx'});
  for(const file of [name,checksum])files.push({name:file,sha256:await fileHash(output+'/'+file),size:(await fs.stat(output+'/'+file)).size});
}
const manifest={schema:1,kind:'runtime',repository:process.env.GITHUB_REPOSITORY,commit:process.env.GITHUB_SHA,ref:process.env.GITHUB_REF,runId:process.env.GITHUB_RUN_ID,files,sourceGraph:built.graph,sdk:built.inputs.sdk,requiresBackendVersion:built.metadata.requiresBackendVersion,requiresLauncherVersion:built.metadata.requiresLauncherVersion,validation:{nativeGateCount:proof.results.length,treeSha256:proof.treeSha256,resultsSha256:await fileHash(validation+'/results.json'),realGameTest:false,stableApproved:false}};
await fs.writeFile(output+'/candidate.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log('Packaged exact validated main CI bytes and corresponding sources. No release was published.');
