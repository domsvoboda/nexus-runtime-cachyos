// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {project,readJson,sha256} from './inputs.mjs';
import {glibArchitectures} from './portable-glib.mjs';
import {regularWithin,inspectPortableElf} from './portable-elf.mjs';
export const libvaOptions=['--prefix=/usr','--buildtype=release','--wrap-mode=nofallback','-Dwith_x11=yes','-Dwith_glx=no','-Dwith_wayland=no','-Dwith_win32=no','-Denable_docs=false'];
const needed=['libva.so.2','libdrm.so.2','libX11.so.6','libXext.so.6','libXfixes.so.3','libX11-xcb.so.1','libxcb.so.1','libxcb-dri3.so.0','libc.so.6'];
const execute=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
export async function libvaLock(){
 const lock=await readJson(path.join(project,'runtime-libva.lock.json'));
 if(!/^\d+\.\d+\.\d+$/.test(lock.version)||lock.archive!==`libva-${lock.version}.tar.bz2`||lock.url!==`https://github.com/intel/libva/releases/download/${lock.version}/${lock.archive}`||!/^[a-f0-9]{64}$/.test(lock.sha256))throw Error('Invalid pinned libva source');
 return lock;
}
export async function buildPortableLibva(directory,{archive,jobs='4'}={}){
 const lock=await libvaLock();await fs.mkdir(directory,{recursive:false});const sourceArchive=path.join(directory,lock.archive);
 if(archive)await fs.copyFile(archive,sourceArchive,fs.constants.COPYFILE_EXCL);
 else execute('curl',['--proto','=https','--proto-redir','=https','--tlsv1.2','--fail','--location','--connect-timeout','15','--max-time','120','--retry','2','--output',sourceArchive,lock.url]);
 if(sha256(await fs.readFile(sourceArchive))!==lock.sha256)throw Error('Pinned libva source checksum mismatch');
 const listing=execFileSync('tar',['-tjf',sourceArchive],{encoding:'utf8'}).trimEnd().split('\n');
 if(listing.some(n=>!n.startsWith(`libva-${lock.version}/`)||n.split('/').includes('..')))throw Error('Unsafe libva source archive');
 execute('tar',['-xjf',sourceArchive,'-C',directory]);const source=path.join(directory,`libva-${lock.version}`),architectures={};
 for(const triplet of glibArchitectures){
  const build=path.join(directory,'build-'+triplet),cross=path.join(directory,'i386.ini');
  if(triplet==='i386-linux-gnu')await fs.writeFile(cross,"[binaries]\nc = ['gcc', '-m32']\ncpp = ['g++', '-m32']\nar = 'ar'\nstrip = 'strip'\npkg-config = 'pkg-config'\n[host_machine]\nsystem = 'linux'\ncpu_family = 'x86'\ncpu = 'i686'\nendian = 'little'\n",{flag:'wx'});
  const env={...process.env,LC_ALL:'C',PKG_CONFIG_LIBDIR:`/usr/lib/${triplet}/pkgconfig:/usr/share/pkgconfig`};
  const options=[...libvaOptions,`--libdir=lib/${triplet}`,...(triplet==='i386-linux-gnu'?['--cross-file='+cross]:[])];
  execute('meson',['setup',build,source,...options],{env});
  execute('ninja',['-C',build,'-j'+jobs,...Object.values(lock.libraries).map(n=>'va/'+n)],{env});
  const libdir=path.join(directory,'stage/usr/lib',triplet);await fs.mkdir(libdir,{recursive:true});const libraries={};
  for(const [soname,filename]of Object.entries(lock.libraries)){
   const file=path.join(build,'va',filename),identity=inspectPortableElf(file,triplet,soname,needed),bytes=await fs.readFile(file);
   await fs.writeFile(path.join(libdir,filename),bytes,{flag:'wx'});libraries[soname]={filename,sha256:sha256(bytes),...identity};
  }
  architectures[triplet]={options,libraries};
 }
 const license=await fs.readFile(path.join(source,'COPYING'));if(sha256(license)!==lock.licenseSha256)throw Error('Pinned libva license mismatch');
 await fs.writeFile(path.join(directory,'COPYING'),license,{flag:'wx'});
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({schema:1,source:lock.url,sourceSha256:lock.sha256,version:lock.version,license:lock.license,licenseSha256:lock.licenseSha256,architectures},null,2)+'\n',{flag:'wx'});
}
export async function verifyPortableLibva(directory){
 const lock=await libvaLock();for(const name of ['manifest.json','COPYING',lock.archive])await regularWithin(directory,path.join(directory,name));
 const manifest=await readJson(path.join(directory,'manifest.json'));
 if(manifest.schema!==1||manifest.source!==lock.url||manifest.sourceSha256!==lock.sha256||manifest.version!==lock.version||manifest.license!==lock.license||manifest.licenseSha256!==lock.licenseSha256||sha256(await fs.readFile(path.join(directory,lock.archive)))!==lock.sha256||sha256(await fs.readFile(path.join(directory,'COPYING')))!==lock.licenseSha256)throw Error('Portable libva source/license mismatch');
 if(Object.keys(manifest.architectures??{}).sort().join()!==[...glibArchitectures].sort().join())throw Error('Incomplete portable libva architectures');
 for(const triplet of glibArchitectures){
  const libraries=manifest.architectures[triplet].libraries;
  if(Object.keys(libraries??{}).sort().join()!==Object.keys(lock.libraries).sort().join())throw Error('Incomplete portable libva libraries');
  for(const [soname,filename]of Object.entries(lock.libraries)){
   const item=libraries[soname],file=path.join(directory,'stage/usr/lib',triplet,filename);await regularWithin(directory,file);
   if(item.filename!==filename||sha256(await fs.readFile(file))!==item.sha256)throw Error('Portable libva checksum mismatch');
   const identity=inspectPortableElf(file,triplet,soname,needed);
   if(JSON.stringify(identity.needed)!==JSON.stringify(item.needed)||identity.maxGlibc!==item.maxGlibc)throw Error('Portable libva identity mismatch');
  }
 }
 return manifest;
}
export async function stagePortableLibva(directory,files){
 const manifest=await verifyPortableLibva(directory);
 for(const [triplet,arch]of Object.entries(manifest.architectures))for(const [soname,item]of Object.entries(arch.libraries)){
  const libdir=path.join(files,'lib',triplet),bytes=await fs.readFile(path.join(directory,'stage/usr/lib',triplet,item.filename));
  if(sha256(bytes)!==item.sha256)throw Error('Portable libva changed before staging');
  await fs.writeFile(path.join(libdir,item.filename),bytes,{flag:'wx'});await fs.symlink(item.filename,path.join(libdir,soname));
 }
 const notices=path.join(files,'share/doc/nexus-runtime');await fs.mkdir(notices,{recursive:true});
 await fs.copyFile(path.join(directory,'COPYING'),path.join(notices,'libva-COPYING'),fs.constants.COPYFILE_EXCL);
 await fs.copyFile(path.join(directory,'manifest.json'),path.join(notices,'portable-libva.json'),fs.constants.COPYFILE_EXCL);
}
