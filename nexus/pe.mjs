// SPDX-License-Identifier: MIT
// Minimal PE/ELF machine checks for prebuilt auxiliary components.
const peMachines={0x14c:'i386',0x8664:'x86_64',0xaa64:'aarch64'};
const elfMachines={62:'x86_64',183:'aarch64'};
export function peMachine(bytes){
  if(bytes.length<64||bytes.readUInt16LE(0)!==0x5a4d)throw Error('Not a PE image');
  const offset=bytes.readUInt32LE(60);
  if(offset+6>bytes.length||bytes.readUInt32LE(offset)!==0x4550)throw Error('Not a PE image');
  return peMachines[bytes.readUInt16LE(offset+4)]??'unknown';
}
export function elfMachine(bytes){
  if(bytes.length<20||bytes.readUInt32BE(0)!==0x7f454c46||bytes[5]!==1)throw Error('Not a little-endian ELF image');
  return elfMachines[bytes.readUInt16LE(18)]??'unknown';
}
