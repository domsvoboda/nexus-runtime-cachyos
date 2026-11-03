// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {project,run,sha256} from './inputs.mjs';
const file='FEXCore/Source/Interface/Core/LookupCache.cpp';
export async function prepareFexSource(directory,pin){
  if(sha256(await fs.readFile(path.join(directory,file)))!==pin.originalSha256)throw Error('Original FEX cache source mismatch');
  run('git',['apply','--check',path.join(project,pin.file)],directory);
  run('git',['apply',path.join(project,pin.file)],directory);
  await verifyPreparedFex(directory,pin);
}
export async function verifyPreparedFex(directory,pin){
  if(run('git',['rev-parse','HEAD'],directory,{capture:true}).trim()!==pin.commit)throw Error('Prepared FEX checkout changed');
  const changed=run('git',['diff','--name-only','HEAD'],directory,{capture:true}).trim();
  if(changed!==file||run('git',['ls-files','--others','--exclude-standard'],directory,{capture:true}).trim())throw Error('Unexpected FEX source changes');
  if(sha256(await fs.readFile(path.join(directory,file)))!==pin.resultSha256)throw Error('Prepared FEX cache source mismatch');
}
