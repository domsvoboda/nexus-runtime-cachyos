// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {repository} from './inputs.mjs';

test('actual SDK make invocation mounts only the optional verified sibling XML tree read-only',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-xml-sdk-mount-'));
  try{
    const work=path.join(root,'work'),build=path.join(work,'sdk-build'),xml=path.join(work,'xgr-xml2-source'),cargo=path.join(root,'cargo');
    for(const directory of [build,xml,cargo])fs.mkdirSync(directory,{recursive:true});
    const makefile=path.join(build,'Makefile');
    fs.writeFileSync(makefile,`SRCDIR := ${repository}\nBUILD_NAME := fixture\nSTEAMRT_IMAGE := immutable-sdk-fixture\nROOTLESS_CONTAINER := 1\nENABLE_CCACHE := 0\ninclude $(SRCDIR)/Makefile.in\n.PHONY: nexus-print-container-argv\nnexus-print-container-argv:\n\t@printf '%s\\0' $(DOCKER_BASE)\n`);
    const invocation=(engine,parser,options='')=>{
      const args=['--no-print-directory','-s','-C',build,'nexus-print-container-argv',`CONTAINER_ENGINE=${engine}`,`CARGO_HOME=${cargo}`,`CONTAINER_MOUNT_OPTS=${options}`,...(parser?[`NEXUS_XML2_SOURCE=${xml}`]:[])];
      const result=spawnSync('make',args,{encoding:'utf8',env:{...process.env,NEXUS_XML2_SOURCE:''},timeout:10000});
      assert.equal(result.status,0,result.stdout+result.stderr);
      const argv=result.stdout.split('\0').filter(Boolean),volumes=argv.flatMap((v,i)=>v==='-v'?[argv[i+1]]:[]);
      return {argv,volumes};
    };
    const original=invocation('docker',false);
    assert.deepEqual(original.volumes.sort(),[`${repository}:${repository}`,`${build}:${build}`,`${cargo}:${cargo}`].sort());
    for(const [engine,options,suffix] of [['docker','',':ro'],['podman',':Z',':ro,Z']]){
      const actual=invocation(engine,true,options);
      assert.equal(actual.argv[0],engine);assert.ok(actual.volumes.includes(`${xml}:${xml}${suffix}`));
      assert.equal(actual.volumes.length,original.volumes.length+1);
      assert.ok(!actual.volumes.some(volume=>volume.split(':')[0]===work),'do not mount the entire work directory');
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
