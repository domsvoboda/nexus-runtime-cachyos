// SPDX-License-Identifier: MIT
import {validateInputs} from '../inputs.mjs';
export function distributionIdentity(inputs){
  validateInputs(inputs);
  if(inputs.variant)return {repository:'domsvoboda/nexus-runtime-cachyos',namePrefix:'nexus-runtime-cachyos-11.0-experimental'};
  return {repository:'domsvoboda/nexus-runtime',namePrefix:'nexus-runtime-11.0-experimental'};
}
export function distributionName(inputs,commit){
  if(!/^[a-f0-9]{40}$/.test(commit))throw Error('Exact distribution source commit required');
  return distributionIdentity(inputs).namePrefix+'-g'+commit.slice(0,8);
}
