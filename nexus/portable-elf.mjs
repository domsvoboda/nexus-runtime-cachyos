// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export async function regularWithin(root,file){
 const base=path.resolve(root),absolute=path.resolve(file),relative=path.relative(base,absolute);
 if(relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||relative==='..')throw Error('Portable dependency path escapes root');
 if(await fs.realpath(base)!==base)throw Error('Portable dependency root must be canonical');
 let current=base;
 for(const part of ['',...relative.split(path.sep)]){
  if(part)current=path.join(current,part);
  const stat=await fs.lstat(current);
  if(stat.isSymbolicLink()||(current===absolute?!stat.isFile():!stat.isDirectory()))throw Error('Portable dependency must use regular contained files');
 }
 const real=await fs.realpath(absolute),canonical=await fs.realpath(base);
 if(!real.startsWith(canonical+path.sep))throw Error('Portable dependency path escapes root');
 return absolute;
}
export function validatePortableElf({header,dynamic,versions},triplet,soname,allowed){
 if(!header.includes(triplet==='i386-linux-gnu'?'Intel 80386':'Advanced Micro Devices X86-64')||!dynamic.includes(`Library soname: [${soname}]`))throw Error('Wrong portable dependency ELF/SONAME');
 const requirements=[...versions.matchAll(/GLIBC_(\d+)\.(\d+)/g)].map(m=>[+m[1],+m[2]]);
 if(requirements.some(([a,b])=>a>2||(a===2&&b>35)))throw Error('Unportable dependency glibc requirement');
 const needed=[...dynamic.matchAll(/\(NEEDED\).*?\[(.*?)\]/g)].map(m=>m[1]).sort();
 if(needed.some(n=>!allowed.includes(n)))throw Error('Unexpected portable dependency requirement');
 return {needed,maxGlibc:requirements.sort((a,b)=>a[0]-b[0]||a[1]-b[1]).at(-1)?.join('.')??'0.0'};
}
export function inspectPortableElf(file,triplet,soname,allowed){
 const inspect=args=>execFileSync('readelf',args,{encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
 return validatePortableElf({header:inspect(['-h',file]),dynamic:inspect(['-d',file]),versions:inspect(['--version-info',file])},triplet,soname,allowed);
}
