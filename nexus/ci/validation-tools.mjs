// SPDX-License-Identifier: MIT
import fs from 'node:fs/promises';
import path from 'node:path';

const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";

// Proton ships wineboot.exe, not the distro's wineboot shell command. Bind
// every bare Wine command used by component runners to this exact candidate.
export async function prepareValidationTools(files,directory,bin='bin'){
  const root=await fs.realpath(files);
  for(const name of ['wine','wineserver']){
    const file=root+'/'+bin+'/'+name;
    if(!(await fs.stat(file)).isFile())throw Error('Missing candidate command: '+name);
    await fs.access(file,fs.constants.X_OK);
  }
  await fs.mkdir(directory,{recursive:false,mode:0o700});
  const commands={wine:[root+'/'+bin+'/wine'],wineboot:[root+'/'+bin+'/wine','wineboot.exe'],wineserver:[root+'/'+bin+'/wineserver']};
  for(const [name,args]of Object.entries(commands))
    await fs.writeFile(path.join(directory,name),'#!/bin/sh\nexec '+args.map(quote).join(' ')+' "$@"\n',{flag:'wx',mode:0o700});
  return directory;
}

export function validationProcessOutput(result){
  const output=(result.stdout||'')+(result.stderr||'');
  if(result.status===0&&!result.signal&&!result.error)return output;
  const error=result.error?(result.error.code||'error')+': '+result.error.message:'none';
  return output+(output&&!output.endsWith('\n')?'\n':'')+
    'PROCESS status='+result.status+' signal='+(result.signal||'none')+' error='+error+'\n';
}
