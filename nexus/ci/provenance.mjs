// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
export async function fileHash(file,algorithm='sha256') {
  const digest=createHash(algorithm);
  for await(const bytes of createReadStream(file))digest.update(bytes);
  return digest.digest('hex');
}
export async function treeHash(root) {
  const digest=createHash('sha256');
  async function visit(directory) {
    const entries=(await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
    for(const entry of entries) {
      const file=path.join(directory,entry.name),relative=path.relative(root,file),st=await fs.lstat(file);
      if(entry.isDirectory()){digest.update(JSON.stringify(['d',relative,st.mode&0o777])+'\n');await visit(file);}
      else if(entry.isSymbolicLink())digest.update(JSON.stringify(['l',relative,await fs.readlink(file)])+'\n');
      else if(entry.isFile())digest.update(JSON.stringify(['f',relative,st.mode&0o777,st.size,await fileHash(file)])+'\n');
      else throw Error('Unsupported runtime entry: '+relative);
    }
  }
  await visit(root);return digest.digest('hex');
}
export function validateGateResults(results) {
  const expected=['win64-component','win64-authentication','win64-user-contracts','win64-store','win32-component','win32-authentication','win32-user-contracts','win32-store','wine-native-contracts','http','media','graphics'];
  if(!Array.isArray(results)||results.length!==expected.length||results.some((r,i)=>r.name!==expected[i]||r.status!==0||r.signal||r.error||!/^[a-f0-9]{64}$/.test(r.sha256)))throw Error('Incomplete or failed native gates');
}
export async function assertPortable(runtime) {
  runtime=await fs.realpath(runtime);
  async function visit(directory){for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const file=path.join(directory,entry.name);
    if(entry.isDirectory())await visit(file);
    else if(entry.isSymbolicLink()){
      if(['files/share/default_pfx/dosdevices/z:','files/share/default_pfx_arm64/dosdevices/z:'].includes(path.relative(runtime,file))&&await fs.readlink(file)==='/')continue;
      if(!(await fs.realpath(file)).startsWith(runtime+path.sep))throw Error('External runtime dependency: '+path.relative(runtime,file));
    }
  }}
  await visit(runtime);
}
