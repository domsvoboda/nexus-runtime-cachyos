// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {mediaArguments,mediaSonames,verifyBundledMedia,cachyosFfmpegCommit} from '../runtime-tests/media-abi.mjs';
const metadata={variant:{family:'nexus-cachyos'},sourceGraph:{submodules:[' '+cachyosFfmpegCommit+' ffmpeg (n7.1.3)']}};
test('pinned runtime families require distinct reviewed FFmpeg ABI sets',()=>{
 assert.deepEqual(mediaSonames('nexus',{}),['libavcodec.so.58','libavfilter.so.7','libavformat.so.58','libavutil.so.56']);
 assert.deepEqual(mediaSonames('nexus-cachyos',metadata),['libavcodec.so.61','libavfilter.so.10','libavformat.so.61','libavutil.so.59']);
 assert.match(execFileSync('git',['ls-tree','HEAD','ffmpeg'],{encoding:'utf8'}),new RegExp(cachyosFfmpegCommit+'\\s+ffmpeg'));
 for(const value of [{},{...metadata,variant:{family:'other'}},{...metadata,sourceGraph:{submodules:[' '+'a'.repeat(40)+' ffmpeg (unreviewed)']}}])assert.throws(()=>mediaSonames('nexus-cachyos',value));
 assert.throws(()=>mediaArguments(['--family','arbitrary','runtime','work']),/Unsupported pinned media family/);
 assert.deepEqual(mediaArguments(['--family','nexus-cachyos','runtime','work']),{family:'nexus-cachyos',args:['runtime','work']});
});
test('bundled media rejects host, mixed, missing, duplicate and escaping libraries',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-media-abi-'));
 try{
  const libs=mediaSonames('nexus-cachyos',metadata);
  for(const lib of libs)await fs.writeFile(path.join(root,lib),'synthetic library');
  const line=(name,file)=>'\t'+name+' => '+file+' (0x0000000000000001)';
  const valid=libs.map(lib=>line(lib,path.join(root,lib))).join('\n');
  await verifyBundledMedia(valid,root,libs);
  for(const text of [valid.replace(root,'/usr/lib'),valid+'\n'+line('libavcodec.so.58',root+'/libavcodec.so.58'),valid.replace(libs[0],libs[0]+'.wrong'),valid+'\n'+line(libs[0],root+'/'+libs[0]),valid+'\nlibva.so.2 => not found'])await assert.rejects(verifyBundledMedia(text,root,libs));
  await fs.rename(root+'/'+libs[0],root+'/'+libs[0]+'.actual');await fs.symlink(libs[0]+'.actual',root+'/'+libs[0]);await verifyBundledMedia(valid,root,libs);
  await fs.unlink(root+'/'+libs[0]);await fs.symlink('/etc/passwd',root+'/'+libs[0]);await assert.rejects(verifyBundledMedia(valid,root,libs),/escapes/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
