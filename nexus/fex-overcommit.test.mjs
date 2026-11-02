// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {prepareFexSource,verifyPreparedFex} from './fex-source.mjs';
import {verifyInputs,sha256,sourceEnvironment} from './inputs.mjs';
const file='FEXCore/Source/Interface/Core/LookupCache.cpp';
const {inputs}=await verifyInputs();
const original=await fs.readFile(new URL('./tests/fixtures/fex-lookup-cache.cpp',import.meta.url),'utf8');
const env=sourceEnvironment();
const git=(directory,...args)=>execFileSync('git',args,{cwd:directory,env,encoding:'utf8'}).trim();

test('actual pinned cache destructor cannot unregister an allocation that reuses its address',async()=>{
  assert.equal(sha256(original),inputs.fex.originalSha256);
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nexus-fex-overcommit-')),source=root+'/source';
  try{
    await fs.mkdir(path.dirname(source+'/'+file),{recursive:true});await fs.writeFile(source+'/'+file,original);
    git(source,'init','--quiet');git(source,'add','.');git(source,'-c','user.name=Source fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','Pinned upstream fixture');
    const pin={...inputs.fex,commit:git(source,'rev-parse','HEAD')};
    await prepareFexSource(source,pin);
    const fixed=await fs.readFile(source+'/'+file,'utf8');
    for(const [label,text]of [['baseline',original],['fixed',fixed]]){
      // Compile the real destructor body, not a second implementation. The
      // allocator schedules another owner immediately when the address is freed.
      const destructor=text.match(/LookupCache::~LookupCache\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(destructor);
      const program=`#include <cstdint>
#include <cstddef>
#include <cstdlib>
namespace FEXCore {
struct Handler { bool registered=true,freed=false,reused=false,reuse=true; unsigned unmarks=0;
 void UnmarkOvercommitRange(uintptr_t p,size_t n){if(p!=0x10000||n!=0x10000)std::abort();registered=false;++unmarks;}
};
Handler handler;
namespace Allocator { void VirtualFree(void *p,size_t n){if(p!=(void*)0x10000||n!=0x10000)std::abort();handler.freed=true;if(handler.reuse){handler.reused=true;handler.registered=true;}} }
struct Context {Handler *SyscallHandler=&handler;};
struct LookupCache {Context *ctx;uintptr_t PagePointer=0x10000;size_t TotalCacheSize=0x10000;~LookupCache();};
${destructor}
}
int main(int argc,char**){using namespace FEXCore;handler.reuse=argc==1;Context context;{LookupCache cache{&context};}
 if(!handler.freed||handler.unmarks!=1)return 2;
 return handler.reuse ? !(handler.reused&&handler.registered) : handler.registered;
}
`;
      await fs.writeFile(root+'/'+label+'.cpp',program);
      execFileSync('c++',['-std=c++17','-Wall','-Wextra','-Werror',root+'/'+label+'.cpp','-o',root+'/'+label],{env,timeout:60000});
      assert.equal(spawnSync(root+'/'+label,[],{env,timeout:10000}).status,label==='baseline'?1:0,label+' immediate reuse');
      assert.equal(spawnSync(root+'/'+label,['no-reuse'],{env,timeout:10000}).status,0,label+' ordinary retirement');
    }
    await verifyPreparedFex(source,pin);
    await fs.appendFile(source+'/'+file,'\n// unexpected edit\n');
    await assert.rejects(verifyPreparedFex(source,pin),/checksum|mismatch/);
    await fs.writeFile(source+'/'+file,fixed);await fs.writeFile(source+'/foreign.cpp','untracked');
    await assert.rejects(verifyPreparedFex(source,pin),/Unexpected FEX source changes/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('FEX correction remains pinned and validated on fresh and resumed SDK builds',async()=>{
  const source=await fs.readFile(new URL('./build-runtime.mjs',import.meta.url),'utf8');
  assert.match(source,/await prepareFexSource\(fex,inputs.fex\)/);
  assert.match(source,/await verifyPreparedFex\(fex,inputs.fex\)/);
  assert.equal(inputs.fex.commit,'5285020de0b30dbdae7b44d0d83541af2d13d002');
});
