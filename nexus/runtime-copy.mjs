// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
// Preserve Proton's relative prefix links, not references to mutable SDK output.
export function copySdkRedistribution(source,target) {
  return fs.cp(source,target,{recursive:true,errorOnExist:true,force:false,dereference:false,verbatimSymlinks:true});
}

// A redistribution must not depend on the mutable SDK build tree. Prefer a
// relative link to an identical bundled library, otherwise copy only a bounded
// regular SDK file. Never follow an external directory or a user-home link.
export async function makeSdkLinksPortable(runtime,sdkRoot){
  runtime=await fs.realpath(runtime);sdkRoot=await fs.realpath(sdkRoot);
  if(runtime==='/'||sdkRoot==='/'||runtime===sdkRoot)throw Error('Distinct isolated runtime and SDK roots required');
  const inside=(root,file)=>file.startsWith(root+path.sep);
  const hash=async file=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const proof={relative:0,materialized:0,prefixDriveMappings:0};
  async function visit(directory){
    for(const entry of await fs.readdir(directory,{withFileTypes:true})){
      const file=path.join(directory,entry.name),relative=path.relative(runtime,file);
      if(entry.isDirectory()){await visit(file);continue;}
      if(!entry.isSymbolicLink())continue;
      const value=await fs.readlink(file),resolved=path.resolve(directory,value);
      if(['files/share/default_pfx/dosdevices/z:','files/share/default_pfx_arm64/dosdevices/z:'].includes(relative)&&value==='/'){++proof.prefixDriveMappings;continue;}
      const real=await fs.realpath(file);
      if(inside(runtime,resolved)&&inside(runtime,real))continue;
      if(!inside(sdkRoot,real))throw Error('External runtime link is not an SDK file: '+relative);
      const stat=await fs.stat(real);
      if(!stat.isFile()||stat.size>128*1024*1024)throw Error('Unbounded SDK link: '+relative);
      const temporary=file+'.nexus-portable-'+process.pid;
      const offset=value.lastIndexOf('/files/');
      const bundled=offset>=0?path.join(runtime,value.slice(offset+1)):null;
      let replacement=false;
      if(bundled&&bundled!==file&&inside(runtime,bundled)){
        try{
          const bundledReal=await fs.realpath(bundled);
          if(!inside(runtime,bundledReal)||!(await fs.stat(bundledReal)).isFile())throw Error('Bundled library escapes runtime: '+relative);
          if(await hash(real)!==await hash(bundledReal))throw Error('SDK link disagrees with bundled bytes: '+relative);
          await fs.symlink(path.relative(directory,bundled),temporary);replacement=true;++proof.relative;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      if(!replacement){await fs.copyFile(real,temporary,fs.constants.COPYFILE_EXCL);++proof.materialized;}
      await fs.rename(temporary,file);
    }
  }
  await visit(runtime);return proof;
}
