// SPDX-License-Identifier: MIT
// Small MinGW fixtures exercise the actual Proton make dependency graph.
// They do not validate Wine, XGameRuntime or a distribution candidate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=fs.readFileSync(path.join(root,'Makefile.in'),'utf8');
const begin=source.indexOf('## xgameruntime\n');
const end=source.indexOf('## Windows Symbol Store creation',begin);
assert.ok(begin>=0&&end>begin);
const rules=source.slice(begin,end).split('\n').filter(line=>!line.startsWith('##')).join('\n');
const moduleBegin=source.indexOf('ifeq ($(module),xgameruntime)');
const moduleEnd=source.indexOf('\nendif',moduleBegin);
assert.ok(moduleBegin>=0&&moduleEnd>moduleBegin);
const modules=source.slice(moduleBegin,moduleEnd+'\nendif'.length);
function fixture(barrier){
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nexus-proton-rules-'));
    const src=path.join(dir,'source/wine/dlls/xgameruntime');
    const obj=path.join(dir,'obj');fs.mkdirSync(src,{recursive:true});fs.mkdirSync(obj);
    fs.writeFileSync(path.join(src,'fixture.cpp'),'extern "C" __declspec(dllexport) int fixture_value() { return 42; }\n');
    fs.writeFileSync(path.join(src,'CMakeLists.txt'),`cmake_minimum_required(VERSION 3.20)
project(make_graph_fixture LANGUAGES CXX)
if(NOT EXISTS "\${WIDL}" OR NOT EXISTS "\${NEXUS_WINEBUILD}")
  message(FATAL_ERROR "Wine host tools were not completed before configure")
endif()
if(NOT NEXUS_WINE_BUILTIN OR ENABLE_TESTS)
  message(FATAL_ERROR "Wrong distribution mode")
endif()
file(APPEND "${dir}/configure.log" "\${CMAKE_INSTALL_LIBDIR}\\n")
add_library(xgameruntime SHARED fixture.cpp)
set_target_properties(xgameruntime PROPERTIES PREFIX "")
install(TARGETS xgameruntime RUNTIME DESTINATION \${CMAKE_INSTALL_LIBDIR})
`);
    for(const [abi,cpu]of [['win32','i686'],['win64','x86_64']])fs.writeFileSync(path.join(src,abi+'-target.cmake'),`set(CMAKE_SYSTEM_NAME Windows)\nset(CMAKE_CXX_COMPILER ${cpu}-w64-mingw32-g++)\n`);
    let block=rules;
    if(!barrier)block=block.replace(/^\$\(OBJ\)\/\.xgameruntime-i386-configure[^\n]*\n/m,'');
    const content=`.DEFAULT_GOAL := default_pfx
SHELL := /bin/bash
SRC := ${root}
SRCDIR := ${dir}/source
OBJ := ${obj}
DST_LIBDIR := ${dir}/dist/lib
HOST_ARCH := x86_64
ARCHS := i386-windows x86_64-windows
J := 4
OBJCOPY := x86_64-w64-mingw32-objcopy
WINE_SRC := ${dir}/source/wine
WINE_x86_64_OBJ := ${obj}/host
include ${root}/make/utility.mk
include ${root}/make/rules-source.mk
include ${root}/make/rules-common.mk
include ${root}/make/rules-cmake.mk
${block}
${modules}
$(OBJ)/.wine-x86_64-tools:
\tsleep 0.1
\tmkdir -p $(WINE_x86_64_OBJ)/tools/widl $(WINE_x86_64_OBJ)/tools/winebuild
\ttouch $(WINE_x86_64_OBJ)/tools/widl/widl $(WINE_x86_64_OBJ)/tools/winebuild/winebuild
\ttouch $@
`;
    fs.writeFileSync(path.join(dir,'Makefile'),content);
    return dir;
}
test('the actual parallel CMake rules require the Wine host-tool barrier',()=>{
    const dir=fixture(false);
    try{
        const result=spawnSync('make',['-j4','module=xgameruntime','module'],{cwd:dir,encoding:'utf8',timeout:60000});
        assert.notEqual(result.status,0);
        assert.match(result.stdout+result.stderr,/Wine host tools were not completed before configure/);
    }finally{fs.rmSync(dir,{recursive:true});}
});
test('module preflight and default prefix use the same two-ABI CMake install',()=>{
    const dir=fixture(true);
    try{
        for(const target of ['module','default_pfx']){
            const result=spawnSync('make',['-j4','module=xgameruntime',target],{cwd:dir,encoding:'utf8',timeout:60000});
            assert.equal(result.status,0,result.stdout+result.stderr);
        }
        const lines=fs.readFileSync(path.join(dir,'configure.log'),'utf8').trim().split('\n').sort();
        assert.deepEqual(lines,['lib/wine/i386-windows','lib/wine/x86_64-windows']);
        for(const [pe,machine]of [['i386-windows',0x14c],['x86_64-windows',0x8664]]){
            const bytes=fs.readFileSync(path.join(dir,'dist/lib/wine',pe,'xgameruntime.dll'));
            assert.equal(bytes.readUInt16LE(bytes.readUInt32LE(0x3c)+4),machine);
        }
    }finally{fs.rmSync(dir,{recursive:true});}
});
