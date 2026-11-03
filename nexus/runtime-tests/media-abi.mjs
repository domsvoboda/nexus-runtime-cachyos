// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';

// CachyOS builds gst-libav against this exact FFmpeg gitlink (n7.1.3).
// Its reviewed libav{codec,filter,format,util} headers define 61/10/61/59.
export const cachyosFfmpegCommit='f46e514491172d15bd74b4abb1814cd2f05a763e';
const families=Object.freeze({
  nexus:Object.freeze(['libavcodec.so.58','libavfilter.so.7','libavformat.so.58','libavutil.so.56']),
  'nexus-cachyos':Object.freeze(['libavcodec.so.61','libavfilter.so.10','libavformat.so.61','libavutil.so.59']),
});
export function mediaArguments(args){
  const family=args[0]==='--family'?args[1]:'nexus';
  if(!Object.hasOwn(families,family))throw Error('Unsupported pinned media family');
  return {family,args:args[0]==='--family'?args.slice(2):args};
}
export function mediaSonames(family,metadata){
  if(!Object.hasOwn(families,family))throw Error('Unsupported pinned media family');
  if((metadata.variant?.family??'nexus')!==family)throw Error('Media family disagrees with runtime metadata');
  if(family==='nexus-cachyos'){
    const rows=metadata.sourceGraph?.submodules?.filter(row=>/^[ +-][a-f0-9]{40} ffmpeg(?: |$)/.test(row));
    if(rows?.length!==1||!rows[0].startsWith(' '+cachyosFfmpegCommit+' ffmpeg '))throw Error('Unreviewed CachyOS FFmpeg source pin');
  }
  return families[family];
}
export async function verifyBundledMedia(dependencies,libraryDir,sonames){
  if(/not found/i.test(dependencies))throw Error(`Bundled GStreamer libav has missing dependencies:\n${dependencies}`);
  const root=await fs.realpath(libraryDir);
  const rows=dependencies.split('\n').map(line=>/^\s*(\S+) => (.+?) \(0x[0-9a-f]+\)\s*$/.exec(line)).filter(Boolean);
  for(const row of rows)if(/^libav(?:codec|filter|format|util)\.so\.\d+$/.test(row[1])&&!sonames.includes(row[1]))throw Error('Unexpected mixed FFmpeg ABI: '+row[1]);
  for(const soname of sonames){
    const matches=rows.filter(row=>row[1]===soname);
    if(matches.length!==1||matches[0][2]!==path.join(root,soname))throw Error(`${soname} is not resolved from the Nexus runtime.`);
    const resolved=await fs.realpath(matches[0][2]);
    if(!resolved.startsWith(root+path.sep)||(await fs.stat(resolved)).isFile()!==true)throw Error(`${soname} escapes the Nexus runtime.`);
  }
}
