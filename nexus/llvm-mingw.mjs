// SPDX-License-Identifier: MIT
// The ARM64 auxiliary build needs an ARM64X-capable MinGW toolchain on the
// aarch64 host. The workflow must supply the exact archive and its SHA-256;
// there is no default, no unpinned fallback and no partial extraction.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const archivePattern=/^https:\/\/github\.com\/mstorsjo\/llvm-mingw\/releases\/download\/(\d{8})\/(llvm-mingw-\1-ucrt-ubuntu-22\.04-aarch64)\.tar\.xz$/;
export function llvmMingwPin(env=process.env){
  const url=env.NEXUS_LLVM_MINGW_URL,sha256=env.NEXUS_LLVM_MINGW_SHA256;
  const match=archivePattern.exec(url??'');
  if(!match)throw Error('NEXUS_LLVM_MINGW_URL must name an aarch64-host llvm-mingw release archive');
  if(!/^[a-f0-9]{64}$/.test(sha256??''))throw Error('NEXUS_LLVM_MINGW_SHA256 is required and must be a lowercase SHA-256');
  return Object.freeze({url,sha256,version:match[1],directory:match[2]});
}
// Download (or copy a local archive), verify, then extract into NEW_DIRECTORY.
export async function fetchLlvmMingw(work,pin,{archive}={}){
  const file=path.join(work,pin.directory+'.tar.xz');
  await fs.mkdir(work,{recursive:false});
  if(archive)await fs.copyFile(archive,file,fs.constants.COPYFILE_EXCL);
  else execFileSync('curl',['--proto','=https','--tlsv1.2','--fail','--location','--silent','--show-error','--retry','2','--max-time','600','--output',file,pin.url],{stdio:'inherit'});
  const actual=createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if(actual!==pin.sha256)throw Error('Pinned llvm-mingw archive checksum mismatch: '+actual);
  const listing=execFileSync('tar',['-tJf',file],{encoding:'utf8',maxBuffer:256*1024*1024}).trimEnd().split('\n');
  for(const entry of listing)if(!entry.startsWith(pin.directory+'/')||entry.split('/').includes('..'))throw Error('Unsafe llvm-mingw archive entry: '+entry);
  execFileSync('tar',['-xJf',file,'-C',work],{stdio:'inherit'});
  const bin=path.join(work,pin.directory,'bin');
  await fs.access(path.join(bin,'arm64ec-w64-mingw32-clang'));
  return bin;
}
