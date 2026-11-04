// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {repository,run,verifySourceGraph} from '../inputs.mjs';
import {sourceModulePlan} from '../source-module-plan.mjs';
import {optInFeature,verifyLocalFeatureMatrix} from '../build-config-parity.mjs';
const usage='Usage: initialize-source.mjs --plan|--initialize [--enable-optional=NAME,NAME]';
export function sourceInitializationArgs(modules,variant,options){
  const plan=sourceModulePlan(modules,variant,options);
  if(!plan.required.length)throw Error('Explicit required source modules are mandatory');
  return ['submodule','update','--init','--recursive','--',...plan.required.map(module=>module.path)];
}
export function sourceInventory(){
  return run('git',['ls-tree','-r','HEAD'],repository,{capture:true}).trim().split('\n').filter(line=>line.startsWith('160000 commit ')).map(line=>({path:line.split('\t')[1],commit:line.split(' ')[2].split('\t')[0]}));
}
// The default fetch plan stays upstream-default. An explicit opt-in prepares
// the default-disabled upstream namespaces whose source is otherwise absent, so
// the upstream build capability is preserved instead of permanently removed.
export function parseSourceInitializationArguments(argv){
  if(!Array.isArray(argv)||!argv.length||argv.length>2)throw Error(usage);
  const [mode,optional]=argv;
  if(!['--plan','--initialize'].includes(mode))throw Error(usage);
  const enable=[];
  if(optional!==undefined){
    const match=/^--enable-optional=(.+)$/.exec(optional);
    if(!match)throw Error(usage);
    for(const name of match[1].split(',')){
      optInFeature(name);
      if(enable.includes(name))throw Error('Duplicate optional source feature: '+name);
      enable.push(name);
    }
  }
  return {initialize:mode==='--initialize',enable};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const {initialize,enable}=parseSourceInitializationArguments(process.argv.slice(2));
  verifyLocalFeatureMatrix(repository);
  const {inputs}=await verifySourceGraph({main:initialize});
  const modules=sourceInventory(),plan=sourceModulePlan(modules,inputs.variant?.family,{enable}),args=sourceInitializationArgs(modules,inputs.variant?.family,{enable});
  if(initialize){run('git',args,repository);await verifySourceGraph({full:true,main:true});}
  console.log(JSON.stringify({schema:1,variant:inputs.variant?.family??'nexus',...plan,command:['git',...args],initialized:initialize},null,2));
}
