// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const waiterFixtureName='nexus_taskqueue-composite-waiters.exe';
export const waiterMinimum=96;
export function requiredWaiterFixtures(inputs){
  if(!inputs.variant)return [];
  if(inputs.variant.family!=='nexus-cachyos')throw Error('Unsupported waiter fixture variant');
  return ['win64','win32'].map(abi=>`${abi}/bin/${waiterFixtureName}`);
}
export function assertWaiterRunner(inputs,text){
  if(!requiredWaiterFixtures(inputs).length)return;
  const match=/\[\s*['"]nexus_taskqueue-composite-waiters['"]\s*,\s*(\d+)\s*\]/.exec(text);
  if(!match||Number(match[1])<waiterMinimum)throw Error('Missing mandatory composite waiter runner gate');
}
export async function verifyWaiterFixtures(root,inputs,hashes){
  for(const relative of requiredWaiterFixtures(inputs)){
    if(!Object.hasOwn(hashes??{},relative)||!/^[a-f0-9]{64}$/.test(hashes?.[relative]??''))throw Error('Missing composite waiter fixture inventory: '+relative);
    const file=path.join(root,relative),stat=await fs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())throw Error('Composite waiter fixture must be a regular file');
    if(!(await fs.realpath(file)).startsWith((await fs.realpath(root))+path.sep))throw Error('Composite waiter fixture escapes its root');
    const bytes=await fs.readFile(file),offset=bytes.length>=64?bytes.readUInt32LE(60):-1;
    if(createHash('sha256').update(bytes).digest('hex')!==hashes[relative])throw Error('Changed composite waiter fixture');
    const machine=relative.startsWith('win64/')?0x8664:0x14c;
    if(bytes.toString('ascii',0,2)!=='MZ'||offset<64||offset+24>bytes.length||bytes.toString('binary',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==machine)throw Error('Wrong composite waiter fixture ABI: '+relative);
  }
}
export function assertWaiterResult(inputs,result){
  if(!requiredWaiterFixtures(inputs).length)return;
  if(result?.passed!==true||!Array.isArray(result.results))throw Error('Incomplete composite waiter native result');
  const matches=result.results.filter(row=>row?.name==='nexus_taskqueue-composite-waiters');
  if(matches.length!==1||!Number.isSafeInteger(matches[0].checks)||matches[0].checks<waiterMinimum||matches[0].failures!==0)throw Error('Incomplete composite waiter native result');
}
