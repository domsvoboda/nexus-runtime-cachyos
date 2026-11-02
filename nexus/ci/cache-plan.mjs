// SPDX-License-Identifier: MIT
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
export function cachePlan(sdk,commit) {
  if(!/^registry\.gitlab\.steamos\.cloud\/proton\/steamrt4\/sdk\/(?:x86_64|arm64-llvm)@sha256:[a-f0-9]{64}$/.test(sdk)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Pinned SDK and exact source required');
  // Both ABIs are separated internally by compiler-content and compiler flags.
  // A new source revision may reuse entries only from the same immutable SDK.
  const namespace='nexus-sdk-v1-'+createHash('sha256').update(sdk).digest('hex');
  return {namespace,key:namespace+'-'+commit,restorePrefix:namespace+'-',maxSize:'3G',compilerCheck:'content'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {inputs}=await import('../inputs.mjs').then(m=>m.verifyInputs());
  const arch=process.argv[2]==='--arch'&&process.argv.length===4?process.argv[3]:process.argv.length===2?'x86_64':null;
  if(!['x86_64','arm64'].includes(arch))throw Error('Usage: cache-plan.mjs [--arch x86_64|arm64]');
  const plan=cachePlan(arch==='arm64'?inputs.sdkArm64:inputs.sdk,process.env.GITHUB_SHA);
  if(!process.env.GITHUB_OUTPUT||!process.env.GITHUB_ENV)throw Error('GitHub output environment required');
  await fs.appendFile(process.env.GITHUB_OUTPUT,`key=${plan.key}\nrestore-prefix=${plan.restorePrefix}\n`);
  await fs.appendFile(process.env.GITHUB_ENV,`CCACHE_NAMESPACE=${plan.namespace}\n`);
}
