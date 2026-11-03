// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {repository,run,verifySourceGraph} from '../inputs.mjs';
import {sourceModulePlan} from '../source-module-plan.mjs';
export function sourceInitializationArgs(modules,variant){
  const plan=sourceModulePlan(modules,variant);
  if(!plan.required.length)throw Error('Explicit required source modules are mandatory');
  return ['submodule','update','--init','--recursive','--',...plan.required.map(module=>module.path)];
}
export function sourceInventory(){
  return run('git',['ls-tree','-r','HEAD'],repository,{capture:true}).trim().split('\n').filter(line=>line.startsWith('160000 commit ')).map(line=>({path:line.split('\t')[1],commit:line.split(' ')[2].split('\t')[0]}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3||!['--plan','--initialize'].includes(process.argv[2]))throw Error('Usage: initialize-source.mjs --plan|--initialize');
  const initialize=process.argv[2]==='--initialize';
  const {inputs}=await verifySourceGraph({main:initialize});
  const modules=sourceInventory(),plan=sourceModulePlan(modules,inputs.variant?.family),args=sourceInitializationArgs(modules,inputs.variant?.family);
  if(initialize){run('git',args,repository);await verifySourceGraph({full:true,main:true});}
  console.log(JSON.stringify({schema:1,variant:inputs.variant?.family??'nexus',...plan,command:['git',...args],initialized:initialize},null,2));
}
