import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {glibLock,glibOptions,glibArchitectures,validateGlibElf} from './portable-glib.mjs';
const soname='libgio-2.0.so.0';
const elf={header:'Machine: Advanced Micro Devices X86-64',dynamic:`(SONAME) Library soname: [${soname}]\n(NEEDED) Shared library: [libglib-2.0.so.0]\n(NEEDED) Shared library: [libz.so.1]`,versions:'GLIBC_2.34 GLIBC_2.14'};
test('portable GLib keeps exact source and both Unix ABIs independent of FFmpeg',async()=>{
 const lock=await glibLock();assert.equal(lock.version,'2.84.4');assert.equal(lock.sha256,'8a9ea10943c36fc117e253f80c91e477b673525ae45762942858aef57631bb90');assert.equal(Object.keys(lock.libraries).length,4);
 assert.deepEqual(glibArchitectures,['x86_64-linux-gnu','i386-linux-gnu']);
 for(const option of ['--wrap-mode=nofallback','-Dlibmount=disabled','-Dselinux=disabled','-Dintrospection=disabled'])assert.ok(glibOptions.includes(option));
});
test('GLib ELF policy rejects new glibc, unexpected closure and wrong ABI/SONAME',()=>{
 assert.deepEqual(validateGlibElf(elf,'x86_64-linux-gnu',soname),{needed:['libglib-2.0.so.0','libz.so.1'],maxGlibc:'2.34'});
 for(const delta of [{versions:'GLIBC_2.38'},{header:'Machine: AArch64'},{dynamic:elf.dynamic+'\n(NEEDED) Shared library: [libmount.so.1]'},{dynamic:elf.dynamic.replace(soname,'libwrong.so.0')}])assert.throws(()=>validateGlibElf({...elf,...delta},'x86_64-linux-gnu',soname));
 assert.equal(validateGlibElf({...elf,header:'Machine: Intel 80386'},'i386-linux-gnu',soname).maxGlibc,'2.34');
});
test('portable compiler helper remains exact and hash verified',async()=>{
 const requirements=await fs.readFile(new URL('./portable-glib-tools.txt',import.meta.url),'utf8');assert.match(requirements,/^meson==1\.7\.2 --hash=sha256:[a-f0-9]{64}\n$/);
});
