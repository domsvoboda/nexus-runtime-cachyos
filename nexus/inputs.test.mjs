// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateInputs,verifyInputs,sourceEnvironment,verifyVariantRuntimeGraph} from './inputs.mjs';
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
test('CachyOS variant pins its actual source graph and supported architecture',()=>{
    assert.equal(inputs.variant.family,'nexus-cachyos');
    for(const mutate of [x=>x.variant.wine='main',x=>x.variant.sourceRepository='other/runtime',x=>x.variant.wineRepository='CachyOS/wine-cachyos',x=>x.variant.architectures.push('arm64'),x=>x.variant.prefixSchema=2,x=>x.variant.xgameruntime='latest']){
        const copy=structuredClone(inputs);mutate(copy);assert.throws(()=>validateInputs(copy));
    }
});

test('recursive variant graph rejects stale or changed Wine and XGR gitlinks',()=>{
 const graph={wine:inputs.variant.wine,xgameruntime:inputs.variant.xgameruntime};
 verifyVariantRuntimeGraph(inputs,graph);
 assert.throws(()=>verifyVariantRuntimeGraph(inputs,{...graph,xgameruntime:'02787d4228d94f54d5bb50d33e2f0b9891d1029a'}));
 assert.throws(()=>verifyVariantRuntimeGraph(inputs,{...graph,wine:'0'.repeat(40)}));
});
