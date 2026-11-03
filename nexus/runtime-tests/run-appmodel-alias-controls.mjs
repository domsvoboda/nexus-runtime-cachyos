// SPDX-License-Identifier: MIT
// Host-created Unix links are not equivalent to Windows reparse-point fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
export async function runAppmodelAliases({wine,tests,root,bits,run}){
 const work=await fs.mkdtemp(path.join(root,`appmodel-alias-${bits}-`));
 const packageRoot=path.join(work,'package'),outside=path.join(work,'outside');
 await fs.mkdir(packageRoot);await fs.mkdir(outside);
 const fixture=path.join(tests,`appmodel-${bits}-probe.exe`);
 await fs.copyFile(fixture,path.join(packageRoot,'probe.exe'));
 await fs.copyFile(fixture,path.join(outside,'probe.exe'));
 await fs.writeFile(path.join(packageRoot,'AppxManifest.xml'),
  "<Package xmlns='http://schemas.microsoft.com/appx/manifest/foundation/windows10'>"+
  "<Identity Name='Nexus.Package' Version='1.2.3.4' ProcessorArchitecture='x64' Publisher='CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US'/>"+
  "<Applications><Application Id='App' Executable='probe.exe'/></Applications></Package>");
 await fs.symlink(path.join(outside,'probe.exe'),path.join(packageRoot,'foreign.exe'));
 await fs.symlink(outside,path.join(packageRoot,'foreign-dir'));
 await fs.symlink(path.join(packageRoot,'probe.exe'),path.join(packageRoot,'internal.exe'));
 await fs.symlink(packageRoot,path.join(work,'package-alias'));
 const win=p=>'Z:'+p.replaceAll('/','\\');
 const cases=[
  ['foreign-file','foreign.exe','none'],
  ['foreign-directory','foreign-dir/probe.exe','none'],
  ['internal-file','internal.exe','valid'],
  ['package-directory','../package-alias/probe.exe','valid']
 ];
 let output='',code=0,timedOut=false,checks=0,failures=0;
 for(const[label,relative,mode]of cases){
  const result=await run(wine,[path.join(packageRoot,relative),'--child',mode,win(packageRoot)]);
  output+=result.output;checks++;
  if(result.code!==0||result.timedOut){failures++;code=1;timedOut||=result.timedOut;output+=`FAIL appmodel-alias-${bits} ${label}\n`;}
 }
 output+=`CHECKS appmodel-alias-${bits} checks=${checks} failures=${failures}\n`;
 return{code,timedOut,output};
}
