// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateInputs,verifyInputs,sourceEnvironment} from './inputs.mjs';
const {inputs}=await verifyInputs();
test('all SDK, auxiliary and shader inputs are immutable development sources',()=>{
    validateInputs(inputs);
    for(const mutate of [x=>x.status='release',x=>x.sdk=x.sdk.split('@')[0]+':latest',x=>x.sdkArm64=x.sdkArm64.split('@')[0]+':latest',x=>x.sdkArm64=x.sdk,x=>x.upstream.wine='latest',x=>delete x.modules.dxvk,x=>x.nghttp2.commit='main',x=>x.shader.file='../private.patch',x=>x.fex.commit='main',x=>x.fex.file='../private.patch',x=>x.fex.resultSha256='invalid',x=>x.compatibilitySources['../private.c']='0'.repeat(64)]){
        const copy=structuredClone(inputs);mutate(copy);assert.throws(()=>validateInputs(copy));
    }
});
test('source tools never inherit account, prefix or title configuration',()=>{
    const env=sourceEnvironment({PATH:'/usr/bin',CCACHE_DIR:'/cache',WINEPREFIX:'/real',WINEDLLPATH:'/old',XUSER_ACCOUNT:'private',XGAMERUNTIME_ACCOUNT:'private',XODUS_TOKEN:'private',NEXUS_PROFILE:'private',STEAM_COMPAT_DATA_PATH:'/real',SteamAppId:'123',LD_PRELOAD:'/foreign'});
    assert.deepEqual(env,{PATH:'/usr/bin',CCACHE_DIR:'/cache',GIT_TERMINAL_PROMPT:'0'});
});
