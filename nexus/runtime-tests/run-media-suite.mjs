#!/usr/bin/env node
// Native media smoke probe. Never starts a game or accesses account data.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {mediaArguments,mediaSonames,verifyBundledMedia} from './media-abi.mjs';
import { targetArgument } from '../target.mjs';

const parsed=targetArgument(process.argv.slice(2));
const target=parsed.target,{family,args}=mediaArguments(parsed.args);
if (args.length !== 2) throw new Error('Usage: run-media-suite.mjs [--arch ARCH] [--family FAMILY] RUNTIME_DIRECTORY WORK_DIRECTORY');
const runtime = await fs.realpath(path.resolve(args[0]));
const work = path.resolve(args[1]);
const libraryDir = await fs.realpath(path.join(runtime, 'files/lib', target.unixLibrary));
const pluginDir = await fs.realpath(path.join(libraryDir, 'gstreamer-1.0'));
if(!libraryDir.startsWith(runtime+path.sep)||!pluginDir.startsWith(libraryDir+path.sep))throw Error('Media directories escape the runtime');
const metadata=JSON.parse(await fs.readFile(path.join(runtime,'XODUS_NEXUS_PATCH.json'),'utf8'));
const sonames=mediaSonames(family,metadata);
const plugin = await fs.realpath(path.join(pluginDir, 'libgstlibav.so'));
if(!plugin.startsWith(pluginDir+path.sep))throw Error('Media plugin escapes the runtime');
await fs.mkdir(work, { recursive: true });
const env = {
  ...process.env,
  LD_LIBRARY_PATH: libraryDir,
  GST_PLUGIN_SYSTEM_PATH_1_0: pluginDir,
  GST_PLUGIN_PATH_1_0: '',
  GST_REGISTRY_FORK: 'no',
  GST_REGISTRY_1_0: path.join(work, 'registry.bin'),
};
const dependencies = execFileSync('ldd', [plugin], { env, encoding: 'utf8' });
await verifyBundledMedia(dependencies,libraryDir,sonames);
const flags = execFileSync('pkg-config', ['--cflags', '--libs', 'gstreamer-1.0'], { encoding: 'utf8' }).trim().split(/\s+/);
const probe = path.join(work, 'media-codecs-probe');
const source = path.join(path.dirname(fileURLToPath(import.meta.url)), 'media-codecs-probe.c');
execFileSync('gcc', ['-O2', '-Wall', source, '-o', probe, ...flags], { stdio: 'inherit' });
const output = execFileSync(probe, [pluginDir], { env, encoding: 'utf8', timeout: 30_000 });
if (!output.includes('Runtime H.264, AAC, ASF, WMV3 and WMA Pro GStreamer components are available.')) throw new Error('Runtime media probe did not pass.');
await fs.writeFile(path.join(work, 'results.json'), JSON.stringify({ h264: true, aac: true, asf: true, wmv3: true, wmapro: true, theora: true, vp8: true, vp9: true, ogg: true, vorbis: true, mp3: true, hls: true, bundledLibraries: true }, null, 2) + '\n');
console.log(output.trim());
