// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const xml2Directory='xgr-xml2-source',xml2Manifest='xgr-xml2-source.json';
export function validateXml2Pin(pin){
 if(!pin||pin.repository!=='ValveSoftware/wine'||pin.commit!=='7fc704ef49c50e9702c9983a5250d5738697bb04'||pin.subtree!=='libs/xml2'||pin.tree!=='27d5326b87ecf1c4042507bb9937a98961f2de0a'||!/^[a-f0-9]{64}$/.test(pin.lockSha256))throw Error('Unreviewed strict XML source');
}
async function lockedFiles(lockFile,pin){
 validateXml2Pin(pin);const bytes=await fs.readFile(lockFile);
 if(sha(bytes)!==pin.lockSha256)throw Error('Strict XML source lock changed');
 const files=JSON.parse(bytes).files;
 if(Object.keys(files).length!==99)throw Error('Complete strict XML source lock required');
 return files;
}
export async function verifyXml2Inventory(directory,files){
 if(!(await fs.lstat(directory)).isDirectory()||await fs.realpath(directory)!==path.resolve(directory))throw Error('Strict XML source directory redirected');
 const actual=[];
 async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){
  const file=path.join(dir,entry.name),name=path.relative(directory,file).split(path.sep).join('/');
  if(entry.isDirectory())await visit(file);
  else if(entry.isFile())actual.push(name);
  else throw Error('Strict XML source cannot contain links or special files');
 }}
 await visit(directory);
 if(actual.sort().join('\n')!==Object.keys(files).sort().join('\n'))throw Error('Strict XML source inventory changed');
 for(const [name,expected]of Object.entries(files)){
  if(!name||path.isAbsolute(name)||name.split('/').some(x=>!x||x==='.'||x==='..')||!/^[a-f0-9]{64}$/.test(expected)||sha(await fs.readFile(path.join(directory,name)))!==expected)throw Error('Strict XML source bytes changed: '+name);
 }
}
export async function verifyXml2Source(work,pin,lockFile){
 const files=await lockedFiles(lockFile,pin),metadata=JSON.parse(await fs.readFile(path.join(work,xml2Manifest),'utf8'));
 if(metadata.schema!==1||JSON.stringify(metadata.identity)!==JSON.stringify(pin)||JSON.stringify(metadata.files)!==JSON.stringify(files)||metadata.licenses?.COPYING!==files.COPYING||metadata.licenses?.AUTHORS!==files.AUTHORS)throw Error('Strict XML provenance changed');
 await verifyXml2Inventory(path.join(work,xml2Directory),files);
 return {identity:pin,manifestSha256:sha(await fs.readFile(path.join(work,xml2Manifest)))};
}
export async function prepareXml2Source(wine,work,pin,lockFile){
 const files=await lockedFiles(lockFile,pin);
 const git=args=>execFileSync('git',args,{cwd:wine,env:{...process.env,GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'},maxBuffer:16*1024*1024});
 if(git(['rev-parse',pin.commit+':'+pin.subtree]).toString().trim()!==pin.tree)throw Error('Strict XML ancestor tree mismatch');
 const lines=git(['ls-tree','-r',pin.commit+':'+pin.subtree]).toString().trim().split('\n');
 const names=lines.map(line=>{const match=/^100644 blob [a-f0-9]{40}\t(.+)$/.exec(line);if(!match)throw Error('Strict XML tree requires regular files');return match[1];});
 if(names.sort().join('\n')!==Object.keys(files).sort().join('\n'))throw Error('Strict XML tree differs from complete source lock');
 const directory=path.join(work,xml2Directory);await fs.mkdir(directory,{recursive:false});
 for(const name of names){
  if(name.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe XML source path');
  const bytes=git(['show',pin.commit+':'+pin.subtree+'/'+name]);
  if(sha(bytes)!==files[name])throw Error('Strict XML ancestor bytes changed');
  await fs.mkdir(path.dirname(path.join(directory,name)),{recursive:true});await fs.writeFile(path.join(directory,name),bytes,{flag:'wx'});
 }
 await fs.writeFile(path.join(work,xml2Manifest),JSON.stringify({schema:1,identity:pin,files,licenses:{COPYING:files.COPYING,AUTHORS:files.AUTHORS}},null,2)+'\n',{flag:'wx'});
 return verifyXml2Source(work,pin,lockFile);
}
