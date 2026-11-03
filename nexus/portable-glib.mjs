// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {project,readJson,sha256} from './inputs.mjs';
import {regularWithin,validatePortableElf,inspectPortableElf} from './portable-elf.mjs';
export const glibOptions=['--prefix=/usr','--buildtype=release','--wrap-mode=nofallback','-Ddefault_library=shared','-Dtests=false','-Dinstalled_tests=false','-Ddocumentation=false','-Dman-pages=disabled','-Dintrospection=disabled','-Dnls=disabled','-Dselinux=disabled','-Dlibmount=disabled','-Dsysprof=disabled','-Dlibelf=disabled','-Ddtrace=disabled','-Dsystemtap=disabled'];
export const glibArchitectures=['x86_64-linux-gnu','i386-linux-gnu'];
const execute=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
const inspect=(command,args)=>execFileSync(command,args,{encoding:'utf8',env:{...process.env,LC_ALL:'C'}});
export async function glibLock(){
 const lock=await readJson(path.join(project,'runtime-glib.lock.json'));
 if(!/^\d+\.\d+\.\d+$/.test(lock.version)||lock.archive!==`glib-${lock.version}.tar.xz`||lock.url!==`https://download.gnome.org/sources/glib/${lock.version.split('.').slice(0,2).join('.')}/${lock.archive}`||!/^[a-f0-9]{64}$/.test(lock.sha256))throw Error('Invalid pinned GLib source');
 return lock;
}
const glibNeeded=triplet=>['libglib-2.0.so.0','libgobject-2.0.so.0','libgmodule-2.0.so.0','libpcre2-8.so.0','libffi.so.8','libz.so.1','libc.so.6',triplet==='i386-linux-gnu'?'ld-linux.so.2':'ld-linux-x86-64.so.2'];
const libraryIdentity=(file,triplet,soname)=>inspectPortableElf(file,triplet,soname,glibNeeded(triplet));
export const validateGlibElf=(elf,triplet,soname)=>validatePortableElf(elf,triplet,soname,glibNeeded(triplet));
export async function buildPortableGlib(directory,{archive,jobs='4'}={}){
 const lock=await glibLock();await fs.mkdir(directory,{recursive:false});
 const sourceArchive=path.join(directory,lock.archive);
 if(archive)await fs.copyFile(archive,sourceArchive,fs.constants.COPYFILE_EXCL);
 else execute('curl',['--proto','=https','--proto-redir','=https','--tlsv1.2','--fail','--location','--connect-timeout','15','--max-time','120','--retry','2','--output',sourceArchive,lock.url]);
 if(sha256(await fs.readFile(sourceArchive))!==lock.sha256)throw Error('Pinned GLib source checksum mismatch');
 const listing=inspect('tar',['-tJf',sourceArchive]).trimEnd().split('\n');
 if(listing.some(n=>!n.startsWith(`glib-${lock.version}/`)||n.split('/').includes('..')))throw Error('Unsafe GLib source archive');
 execute('tar',['-xJf',sourceArchive,'-C',directory]);
 const source=path.join(directory,`glib-${lock.version}`),architectures={};
 for(const triplet of glibArchitectures){
  const build=path.join(directory,'build-'+triplet),cross=path.join(directory,'i386.ini');
  const env={...process.env,LC_ALL:'C',PKG_CONFIG_LIBDIR:`/usr/lib/${triplet}/pkgconfig:/usr/share/pkgconfig`};
  if(triplet==='i386-linux-gnu')await fs.writeFile(cross,"[binaries]\nc = ['gcc', '-m32']\nar = 'ar'\nstrip = 'strip'\npkg-config = 'pkg-config'\n[host_machine]\nsystem = 'linux'\ncpu_family = 'x86'\ncpu = 'i686'\nendian = 'little'\n",{flag:'wx'});
  const options=[...glibOptions,`--libdir=lib/${triplet}`,...(triplet==='i386-linux-gnu'?['--cross-file='+cross]:[])];
  execute('meson',['setup',build,source,...options],{env});
  const targets=Object.values(lock.libraries).map(filename=>filename.slice(3,filename.indexOf('-2.0'))+'/'+filename);
  execute('ninja',['-C',build,'-j'+jobs,...targets],{env});
  const libdir=path.join(directory,'stage/usr/lib',triplet);await fs.mkdir(libdir,{recursive:true});const libraries={};
  for(const [soname,filename]of Object.entries(lock.libraries)){
   const file=path.join(build,filename.slice(3,filename.indexOf('-2.0')),filename),identity=libraryIdentity(file,triplet,soname);
   const bytes=await fs.readFile(file);await fs.writeFile(path.join(libdir,filename),bytes,{flag:'wx'});
   libraries[soname]={filename,sha256:sha256(bytes),...identity};
  }
  architectures[triplet]={options,libraries};
 }
 if(sha256(await fs.readFile(path.join(source,'COPYING')))!==lock.licenseSha256)throw Error('Pinned GLib license mismatch');
 await fs.copyFile(path.join(source,'COPYING'),path.join(directory,'COPYING'),fs.constants.COPYFILE_EXCL);
 await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify({schema:1,source:lock.url,sourceSha256:lock.sha256,version:lock.version,license:lock.license,licenseSha256:sha256(await fs.readFile(path.join(directory,'COPYING'))),architectures},null,2)+'\n',{flag:'wx'});
}
export async function verifyPortableGlib(directory){
 const lock=await glibLock();
 for(const name of ['manifest.json','COPYING',lock.archive])await regularWithin(directory,path.join(directory,name));
 const manifest=await readJson(path.join(directory,'manifest.json'));
 if(manifest.schema!==1||manifest.source!==lock.url||manifest.sourceSha256!==lock.sha256||manifest.version!==lock.version||manifest.license!==lock.license||manifest.licenseSha256!==lock.licenseSha256||sha256(await fs.readFile(path.join(directory,lock.archive)))!==lock.sha256||sha256(await fs.readFile(path.join(directory,'COPYING')))!==manifest.licenseSha256)throw Error('Portable GLib source/license mismatch');
 if(Object.keys(manifest.architectures??{}).sort().join()!==[...glibArchitectures].sort().join())throw Error('Incomplete portable GLib architectures');
 for(const triplet of glibArchitectures){
  const libraries=manifest.architectures[triplet].libraries;
  if(Object.keys(libraries??{}).sort().join()!==Object.keys(lock.libraries).sort().join())throw Error('Incomplete portable GLib libraries');
  for(const [soname,filename]of Object.entries(lock.libraries)){
   const item=libraries[soname],file=path.join(directory,'stage/usr/lib',triplet,filename);
   await regularWithin(directory,file);
   if(item.filename!==filename||sha256(await fs.readFile(file))!==item.sha256)throw Error('Portable GLib checksum mismatch');
   const identity=libraryIdentity(file,triplet,soname);
   if(JSON.stringify(identity.needed)!==JSON.stringify(item.needed)||identity.maxGlibc!==item.maxGlibc)throw Error('Portable GLib identity mismatch');
  }
 }
 return manifest;
}
export async function stagePortableGlib(directory,files){
 const manifest=await verifyPortableGlib(directory);
 for(const [triplet,arch]of Object.entries(manifest.architectures))for(const [soname,item]of Object.entries(arch.libraries)){
  const libdir=path.join(files,'lib',triplet),bytes=await fs.readFile(path.join(directory,'stage/usr/lib',triplet,item.filename));
  if(sha256(bytes)!==item.sha256)throw Error('Portable GLib changed before staging');
  // Exclusive writes deliberately fail if a future SDK starts shipping GLib.
  await fs.writeFile(path.join(libdir,item.filename),bytes,{flag:'wx'});await fs.symlink(item.filename,path.join(libdir,soname));
 }
 const notices=path.join(files,'share/doc/nexus-runtime');await fs.mkdir(notices,{recursive:true});
 await fs.copyFile(path.join(directory,'COPYING'),path.join(notices,'GLib-COPYING'),fs.constants.COPYFILE_EXCL);
 await fs.copyFile(path.join(directory,'manifest.json'),path.join(notices,'portable-glib.json'),fs.constants.COPYFILE_EXCL);
}
