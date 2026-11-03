// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateInputs,verifyInputs} from '../inputs.mjs';
export function pinnedXgrSource(inputs){
  validateInputs(inputs);
  if(inputs.variant?.family!=='nexus-cachyos')throw Error('Pinned CachyOS variant required');
  return {repository:'domsvoboda/nexus-xgameruntime',commit:inputs.variant.xgameruntime};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {inputs}=await verifyInputs();
  const pin=pinnedXgrSource(inputs);
  if(!process.env.GITHUB_OUTPUT||!process.env.GITHUB_STEP_SUMMARY)throw Error('GitHub evidence outputs required');
  await fs.appendFile(process.env.GITHUB_OUTPUT,`repository=${pin.repository}\ncommit=${pin.commit}\n`);
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY,`Pinned XGameRuntime source contracts: ${pin.repository}@${pin.commit}\n`);
  console.log(JSON.stringify(pin));
}
