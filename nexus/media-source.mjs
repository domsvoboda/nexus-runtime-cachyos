// SPDX-License-Identifier: MIT
// Preserve exact source bytes when the upstream archive server is unavailable.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileHash} from './ci/provenance.mjs';

export async function fetchMediaSource(lock,destination,{execute=execFileSync}={}){
  if(!/^ffmpeg-\d+\.\d+\.\d+\.tar\.xz$/.test(lock.archive)||lock.url!==`https://ffmpeg.org/releases/${lock.archive}`||!/^[a-f0-9]{64}$/.test(lock.sha256))throw Error('Invalid pinned media source');
  const fallback=lock.sourceBundle;
  const match=/^https:\/\/github\.com\/domsvoboda\/nexus-runtime\/releases\/download\/runtime-11\.0-\d{8}-g([a-f0-9]{8})\/nexus-runtime-11\.0-experimental-g([a-f0-9]{8})-source\.tar\.xz$/.exec(fallback?.url||'');
  if(!match||match[1]!==match[2]||!/^[a-f0-9]{64}$/.test(fallback.sha256)||fallback.member!=='media/'+lock.archive)throw Error('Invalid pinned media source bundle');
  // Exclusive ownership keeps partial downloads out of the final archive and
  // prevents overwriting any caller file. Only this new scratch directory dies.
  const scratch=await fs.mkdtemp(path.join(path.dirname(destination),'.media-source-'));
  await fs.chmod(scratch,0o700);
  const download=(url,file,maxTime)=>execute('curl',['--proto','=https','--proto-redir','=https','--tlsv1.2','--fail','--location','--silent','--show-error','--connect-timeout','15','--max-time',String(maxTime),'--retry','2','--retry-delay','2','--retry-max-time',String(maxTime),'--retry-all-errors','--output',file,url],{stdio:'inherit',timeout:(maxTime*2+30)*1000});
  try{
    let upstream=true;
    const archive=scratch+'/archive';
    try{download(lock.url,archive,45);}catch{upstream=false;}
    if(upstream){
      // A completed transfer with wrong bytes is not an availability failure.
      if(await fileHash(archive)!==lock.sha256)throw Error('Pinned media archive checksum mismatch');
      await fs.copyFile(archive,destination,fs.constants.COPYFILE_EXCL);
      return {url:lock.url,sha256:lock.sha256};
    }
    console.log('Upstream media source unavailable; using the pinned corresponding-source bundle.');
    const bundle=scratch+'/source.tar.xz';download(fallback.url,bundle,180);
    if(await fileHash(bundle)!==fallback.sha256)throw Error('Pinned media source bundle checksum mismatch');
    const bytes=execute('tar',['-xJOf',bundle,'--',fallback.member],{timeout:120000,maxBuffer:32*1024*1024});
    const extracted=scratch+'/extracted';await fs.writeFile(extracted,bytes,{flag:'wx'});
    if(await fileHash(extracted)!==lock.sha256)throw Error('Pinned bundled media archive checksum mismatch');
    await fs.copyFile(extracted,destination,fs.constants.COPYFILE_EXCL);
    return {url:fallback.url,sha256:fallback.sha256,member:fallback.member,memberSha256:lock.sha256};
  }finally{await fs.rm(scratch,{recursive:true,force:true});}
}
