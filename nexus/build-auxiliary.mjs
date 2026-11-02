// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {project,run,checkout,verifyInputs,sha256} from './inputs.mjs';
import {buildCompatibility} from './runtime-compat/build.mjs';
import {targetArgument} from './target.mjs';
import {llvmMingwPin,fetchLlvmMingw} from './llvm-mingw.mjs';
import {peMachine,elfMachine} from './pe.mjs';
const {target,args}=targetArgument(process.argv.slice(2));
const [flag,directory]=args;
if(flag!=='--work'||!directory||args.length!==2)throw Error('Usage: build-auxiliary.mjs [--arch x86_64|arm64] --work NEW_DIRECTORY');
if(({x64:'x86_64',arm64:'aarch64'})[process.arch]!==target.machine)throw Error('Auxiliary components must be built on a native '+target.machine+' host');
// Check the toolchain pin before any work: a missing or malformed pin is fatal.
const toolchain=target.name==='arm64'?llvmMingwPin():null;
const work=path.resolve(directory),{inputs}=await verifyInputs();
await fs.mkdir(work,{recursive:false});
const source=path.join(work,'nghttp2-src');
await checkout(inputs.nghttp2,source);
const components=path.join(work,'components');
const compatibility=await buildCompatibility(components);
if(elfMachine(await fs.readFile(path.join(components,'wine-launcher')))!==target.machine)throw Error('Wine runtime shim has the wrong architecture');
const common=['-DCMAKE_SYSTEM_NAME=Windows','-DENABLE_LIB_ONLY=ON','-DBUILD_SHARED_LIBS=ON','-DBUILD_STATIC_LIBS=OFF','-DENABLE_DOC=OFF','-DENABLE_APP=OFF','-DENABLE_EXAMPLES=OFF','-DENABLE_FAILMALLOC=OFF','-DBUILD_TESTING=OFF'];
const builds=[['x86_64',[`-DCMAKE_C_COMPILER=x86_64-w64-mingw32-gcc`,`-DCMAKE_RC_COMPILER=x86_64-w64-mingw32-windres`,'-DCMAKE_SHARED_LINKER_FLAGS=-static-libgcc']],['i386',[`-DCMAKE_C_COMPILER=i686-w64-mingw32-gcc`,`-DCMAKE_RC_COMPILER=i686-w64-mingw32-windres`,'-DCMAKE_SHARED_LINKER_FLAGS=-static-libgcc']]];
if(toolchain){
  // One ARM64X image serves both native aarch64 and ARM64EC (x86_64 under FEX)
  // processes from lib/wine/aarch64-windows, matching Proton's ARM64X DXVK.
  const bin=await fetchLlvmMingw(path.join(work,'llvm-mingw'),toolchain);
  builds.push(['aarch64',[`-DCMAKE_C_COMPILER=${bin}/arm64ec-w64-mingw32-clang`,`-DCMAKE_RC_COMPILER=${bin}/arm64ec-w64-mingw32-windres`,'-DCMAKE_SYSTEM_PROCESSOR=ARM64','-DCMAKE_C_FLAGS=-marm64x','-DCMAKE_SHARED_LINKER_FLAGS=-marm64x']]);
}
const libraries={};
for(const [arch,options] of builds){
  const build=path.join(work,'nghttp2-'+arch);
  run('cmake',['-S',source,'-B',build,...common,...options],work);
  run('cmake',['--build',build,'--parallel','4'],work);
  const output=path.join(components,arch);await fs.mkdir(output);
  const file=path.join(output,'libnghttp2.dll');
  await fs.copyFile(path.join(build,'lib/libnghttp2.dll'),file);
  const bytes=await fs.readFile(file);
  if(peMachine(bytes)!==arch)throw Error('nghttp2 has the wrong PE machine: '+arch);
  libraries[arch]=sha256(bytes);
}
const headers=path.join(components,'nghttp2');await fs.mkdir(headers);
await fs.copyFile(path.join(source,'lib/includes/nghttp2/nghttp2.h'),path.join(headers,'nghttp2.h'));
await fs.copyFile(path.join(work,'nghttp2-x86_64/lib/includes/nghttp2/nghttp2ver.h'),path.join(headers,'nghttp2ver.h'));
await fs.copyFile(path.join(source,'COPYING'),path.join(components,'nghttp2-LICENSE'));
const headerHashes={};for(const name of ['nghttp2.h','nghttp2ver.h'])headerHashes[name]=sha256(await fs.readFile(path.join(headers,name)));
const manifest={schema:1,inputsSha256:sha256(await fs.readFile(path.join(project,"inputs.lock.json"))),source:inputs.nghttp2,compatibility,libraries,headers:headerHashes};
if(toolchain)Object.assign(manifest,{arch:target.name,toolchain:{url:toolchain.url,sha256:toolchain.sha256}});
await fs.writeFile(path.join(work,'auxiliary.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
run('node',[path.join(project,'build-runtime-media.mjs'),'--work',path.join(work,'media'),'--jobs','4'],project);
run('node',[path.join(project,'ci/check-media-glibc.mjs'),path.join(work,'media/media-manifest.json')],project);
