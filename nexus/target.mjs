// SPDX-License-Identifier: MIT
// Proton target architectures. x86_64 stays the default; arm64 is the
// Experimental native ARM64 build of the same pinned source graph.
export const targets=Object.freeze({
  x86_64:Object.freeze({name:'x86_64',sdk:'sdk',hostTools:'x86_64',machine:'x86_64',unixLibrary:'x86_64-linux-gnu',bin:'bin',prefix:'default_pfx',primaryPe:'x86_64',peArchitectures:Object.freeze(['x86_64','i386']),suffix:''}),
  arm64:Object.freeze({name:'arm64',sdk:'sdkArm64',hostTools:'aarch64',machine:'aarch64',unixLibrary:'aarch64-linux-gnu',bin:'bin-arm64',prefix:'default_pfx_arm64',primaryPe:'aarch64',peArchitectures:Object.freeze(['aarch64','x86_64','i386']),suffix:'-arm64'}),
});
export function target(name='x86_64'){
  if(!Object.hasOwn(targets,name))throw Error('Unsupported target architecture');
  return targets[name];
}
// Parse an optional leading `--arch NAME` and return the remaining arguments.
export function targetArgument(args){
  if(args[0]!=='--arch')return {target:targets.x86_64,args};
  if(!args[1])throw Error('--arch requires x86_64 or arm64');
  return {target:target(args[1]),args:args.slice(2)};
}
