// SPDX-License-Identifier: MIT
// Offline, noncompiling contracts for the pinned NVML header preparation.
// Host fixtures are local Git repositories, the downloader is a local Node
// script, and the container view is simulated with a detached Git directory and
// a denying git shim. No test reaches the network, runs the upstream generator
// or invokes a compiler. Fixtures honour TMPDIR so local runs can keep them in
// the owned temporary directory.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {NVML_MODULE_PATH, nvmlPreflightRequired} from './nvml-preflight.mjs';

const project = path.dirname(fileURLToPath(import.meta.url));
const repository = path.dirname(project);
const helperPath = path.join(project, 'prepare-nvml-header.sh');
const lockPath = path.join(project, 'nvml-header.lock.json');
const makefilePath = path.join(repository, 'nvidia-libs/build-wine-nvml.mk');
const buildRuntimePath = path.join(project, 'build-runtime.mjs');

const sha256 = value => createHash('sha256').update(value).digest('hex');
const HEADER_BYTES = Buffer.from('/* synthetic NVML header fixture */\n#define NVML_API_VERSION 10\n', 'utf8');
const TAMPERED_BYTES = Buffer.from('#'.repeat(HEADER_BYTES.length), 'utf8');
const FIXTURE_VERSION = '9.8.7';
const FIXTURE_MODULE = 'nvidia-libs/wine-nvml';
const FIXTURE_REPOSITORY = 'https://github.com/NVIDIA/nvidia-settings';
const FIXTURE_COMMIT = 'a'.repeat(40);
const GENERATOR = '#!/bin/sh\nexit 0\n';
const GENERATOR_INPUTS = {
  'meson.build': "project('wine-nvml', 'c')\n",
  'src/meson.build': "nvml_src = ['nvml.c']\n",
  'src/make_nvml': GENERATOR,
};

function fixtureLock(moduleCommit, overrides = {}) {
  const base = {
    schema: 1,
    component: 'wine-nvml',
    variant: 'nexus-cachyos',
    module: FIXTURE_MODULE,
    moduleCommit,
    name: 'nvml.h',
    version: FIXTURE_VERSION,
    declaredTag: FIXTURE_VERSION,
    declaredBy: 'test fixture',
    repository: FIXTURE_REPOSITORY,
    commit: FIXTURE_COMMIT,
    url: `https://raw.githubusercontent.com/NVIDIA/nvidia-settings/${FIXTURE_COMMIT}/src/nvml.h`,
    sha256: sha256(HEADER_BYTES),
    bytes: HEADER_BYTES.length,
    gitBlobSha1: 'd'.repeat(40),
  };
  return {...base, ...overrides};
}

function git(cwd, ...args) {
  const result = spawnSync('git', ['-C', cwd, ...args], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fakeCurlSource() {
  return `#!${process.execPath}
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(process.env.NVML_TEST_CURL_CONFIG, 'utf8'));
fs.appendFileSync(config.log, JSON.stringify(process.argv.slice(2)) + '\\n');
if (config.mode === 'http-error') {
  process.stderr.write('curl: (22) The requested URL returned error: 404\\n');
  process.exit(22);
}
if (config.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, config.delayMs);
const output = process.argv.indexOf('--output');
if (output < 0 || !process.argv[output + 1]) {
  process.stderr.write('fake curl: missing --output\\n');
  process.exit(2);
}
const body = config.mode === 'corrupt' ? fs.readFileSync(config.tamper) : fs.readFileSync(config.payload);
fs.writeFileSync(process.argv[output + 1], body);
`;
}

function fakeDeniedGitSource() {
  return `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.NVML_TEST_GIT_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
process.stderr.write('fatal: not a git repository: the metadata is outside the mounted tree\\n');
process.exit(128);
`;
}

function createFixture(t, {mode = 'ok', payload = HEADER_BYTES, delayMs = 0, lockOverrides = {}} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-nvml-header-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const repo = path.join(root, 'repo');
  const moduleRoot = path.join(repo, ...FIXTURE_MODULE.split('/'));
  const srcPath = path.join(moduleRoot, 'src');
  fs.mkdirSync(srcPath, {recursive: true});
  fs.mkdirSync(path.join(repo, 'nexus'), {recursive: true});
  fs.mkdirSync(path.join(root, 'build'), {recursive: true});
  for (const [relative, body] of Object.entries(GENERATOR_INPUTS)) {
    fs.writeFileSync(path.join(moduleRoot, relative), body);
  }

  git(moduleRoot, 'init', '-q');
  git(moduleRoot, 'add', '-A');
  git(moduleRoot, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'fixture');
  const moduleCommit = git(moduleRoot, 'rev-parse', 'HEAD');

  const {gitlinkCommit = moduleCommit, ...lockFields} = lockOverrides;
  const lock = fixtureLock(moduleCommit, lockFields);
  const fixtureLockPath = path.join(repo, 'nexus/nvml-header.lock.json');
  fs.writeFileSync(fixtureLockPath, `${JSON.stringify(lock, null, 2)}\n`);

  git(repo, 'init', '-q');
  git(repo, 'update-index', '--add', '--cacheinfo', `160000,${gitlinkCommit},${FIXTURE_MODULE}`);
  git(repo, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'fixture');
  const sourceHead = git(repo, 'rev-parse', 'HEAD');

  const payloadPath = path.join(root, 'payload.bin');
  fs.writeFileSync(payloadPath, payload);
  const tamperPath = path.join(root, 'tamper.bin');
  fs.writeFileSync(tamperPath, TAMPERED_BYTES);
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, {recursive: true});
  const curlLog = path.join(root, 'curl.log');
  const gitLog = path.join(root, 'git.log');
  const curlConfig = path.join(root, 'curl.json');
  fs.writeFileSync(curlConfig, JSON.stringify({log: curlLog, payload: payloadPath, tamper: tamperPath, mode, delayMs}));
  fs.writeFileSync(path.join(bin, 'curl'), fakeCurlSource(), {mode: 0o755});

  const proofPath = path.join(root, 'build/nvml-header-proof.json');
  const headerPath = path.join(srcPath, `nvml_${lock.version}.h`);
  const command = (args) => ({
    args,
    env: {...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, NVML_TEST_CURL_CONFIG: curlConfig, NVML_TEST_GIT_LOG: gitLog},
  });

  const fixture = {
    root,
    repo,
    moduleRoot,
    srcPath,
    headerPath,
    lockPath: fixtureLockPath,
    lock,
    moduleCommit,
    sourceHead,
    proofPath,
    bin,
    curlLog,
    gitLog,
    runHostPrepare({source = repo, proof = proofPath} = {}) {
      const {args, env} = command([helperPath, 'host-prepare', '--source', source, '--proof', proof]);
      return spawnSync('bash', args, {encoding: 'utf8', env});
    },
    runPrepare({source = repo, version = lock.version, proof = proofPath, dests = []} = {}) {
      const args = [helperPath, 'prepare', '--source', source, '--version', version, '--proof', proof];
      for (const dest of dests) args.push('--dest', dest);
      const {env} = command(args);
      return spawnSync('bash', args, {encoding: 'utf8', env});
    },
    runVersion({source = repo, version = lock.version, proof = proofPath} = {}) {
      const {args, env} = command([helperPath, 'version', '--source', source, '--version', version, '--proof', proof]);
      return spawnSync('bash', args, {encoding: 'utf8', env});
    },
    runPrepareAsync({source = repo, version = lock.version, proof = proofPath, dests = []} = {}) {
      const args = [helperPath, 'prepare', '--source', source, '--version', version, '--proof', proof];
      for (const dest of dests) args.push('--dest', dest);
      const {env} = command(args);
      return new Promise(resolve => {
        const child = spawn('bash', args, {env});
        let stderr = '';
        child.stderr.on('data', chunk => {
          stderr += chunk;
        });
        child.on('close', code => resolve({status: code, stderr}));
      });
    },
    runHostPrepareAsync({source = repo, proof = proofPath} = {}) {
      const {args, env} = command([helperPath, 'host-prepare', '--source', source, '--proof', proof]);
      return new Promise(resolve => {
        const child = spawn('bash', args, {env});
        let stderr = '';
        child.stderr.on('data', chunk => {
          stderr += chunk;
        });
        child.on('close', code => resolve({status: code, stderr}));
      });
    },
    curlCalls() {
      if (!fs.existsSync(curlLog)) return [];
      return fs.readFileSync(curlLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    },
    gitCalls() {
      if (!fs.existsSync(gitLog)) return [];
      return fs.readFileSync(gitLog, 'utf8').trim().split('\n').filter(Boolean);
    },
    denyGit() {
      fs.writeFileSync(path.join(bin, 'git'), fakeDeniedGitSource(), {mode: 0o755});
    },
    simulateDetachedGit() {
      fs.renameSync(path.join(repo, '.git'), path.join(root, 'detached-parent-git'));
      fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /unmounted/parent/.git/worktrees/fixture\n');
      fs.renameSync(path.join(moduleRoot, '.git'), path.join(root, 'detached-module-git'));
      fs.writeFileSync(path.join(moduleRoot, '.git'), 'gitdir: /unmounted/parent/.git/modules/fixture\n');
    },
    linkSourceDirectory(target) {
      const held = path.join(root, 'held-src');
      fs.renameSync(srcPath, held);
      fs.symlinkSync(target, srcPath);
    },
    leftovers() {
      return fs.readdirSync(srcPath).filter(name => name.startsWith('.nvml-header-') || name.startsWith('.nvml-proof-'));
    },
    readProof() {
      return JSON.parse(fs.readFileSync(proofPath, 'utf8'));
    },
    writeProof(proof) {
      fs.writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`);
    },
    destDirectory(name = 'dest/src') {
      const directory = path.join(root, name);
      fs.mkdirSync(directory, {recursive: true});
      return directory;
    },
  };
  return fixture;
}

test('host preflight verifies Git identity, prepares the header and writes the proof', t => {
  const fixture = createFixture(t);
  const dest = fixture.destDirectory('build-so/src');
  const result = fixture.runHostPrepare();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(fixture.headerPath, 'utf8'), HEADER_BYTES.toString('utf8'));
  const proof = fixture.readProof();
  assert.equal(proof.schema, 1);
  assert.equal(proof.component, 'wine-nvml');
  assert.equal(proof.sourcePath, fixture.repo);
  assert.equal(proof.sourceRoot, fs.realpathSync(fixture.repo));
  assert.equal(proof.sourceHead, fixture.sourceHead);
  assert.equal(proof.module, FIXTURE_MODULE);
  assert.equal(proof.moduleCommit, fixture.moduleCommit);
  assert.equal(proof.moduleHead, fixture.moduleCommit);
  assert.equal(proof.version, FIXTURE_VERSION);
  assert.equal(proof.lockSha256, sha256(fs.readFileSync(fixture.lockPath)));
  assert.equal(proof.header.path, `${FIXTURE_MODULE}/src/nvml_${FIXTURE_VERSION}.h`);
  assert.equal(proof.header.sha256, sha256(HEADER_BYTES));
  assert.equal(proof.header.bytes, HEADER_BYTES.length);
  assert.deepEqual(proof.generator.map(entry => entry.path), ['src/make_nvml', 'src/meson.build', 'meson.build']);
  for (const entry of proof.generator) {
    assert.equal(entry.sha256, sha256(fs.readFileSync(path.join(fixture.moduleRoot, entry.path))));
  }
  assert.equal(fixture.curlCalls().length, 1);
  const args = fixture.curlCalls()[0];
  assert.equal(args.at(-1), fixture.lock.url);
  for (const flag of ['--fail', '--location', '--output', '--max-time', '--max-filesize', '--retry']) assert.ok(args.includes(flag), flag);
  assert.equal(args[args.indexOf('--proto') + 1], '=https');
  assert.equal(args[args.indexOf('--proto-redir') + 1], '=https');
  assert.ok(args.includes('--tlsv1.2'));
  assert.notEqual(args[args.indexOf('--output') + 1], fixture.headerPath);
  assert.deepEqual(fixture.leftovers(), []);
  const prepared = fixture.runPrepare({dests: [dest]});
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(fixture.curlCalls().length, 1);
  assert.deepEqual(fixture.gitCalls(), []);
  assert.equal(fs.readFileSync(path.join(dest, `nvml_${FIXTURE_VERSION}.h`), 'utf8'), HEADER_BYTES.toString('utf8'));
  assert.deepEqual(fixture.leftovers(), []);
});

test('host preflight reuses a verified header and an identical proof', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const before = fs.statSync(fixture.proofPath);
  const second = fixture.runHostPrepare();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fixture.curlCalls().length, 1);
  const after = fs.statSync(fixture.proofPath);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.match(second.stderr, /reusing verified/);
});

test('host preflight refuses a missing or foreign Git identity before downloading', t => {
  const unavailable = createFixture(t);
  unavailable.denyGit();
  const denied = unavailable.runHostPrepare();
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /git is required|upstream|not a git repository|cannot read/);
  assert.deepEqual(unavailable.curlCalls(), []);
  assert.equal(fs.existsSync(unavailable.headerPath), false);
  assert.equal(fs.existsSync(unavailable.proofPath), false);

  const gitlink = createFixture(t, {lockOverrides: {gitlinkCommit: 'e'.repeat(40)}});
  const mismatchedGitlink = gitlink.runHostPrepare();
  assert.notEqual(mismatchedGitlink.status, 0);
  assert.match(mismatchedGitlink.stderr, /parent Git link mismatch/);
  assert.deepEqual(gitlink.curlCalls(), []);

  const head = createFixture(t);
  fs.writeFileSync(path.join(head.srcPath, 'make_nvml'), '#!/bin/sh\nexit 1\n');
  git(head.moduleRoot, 'add', '-A');
  git(head.moduleRoot, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'moved');
  const mismatchedHead = head.runHostPrepare();
  assert.notEqual(mismatchedHead.status, 0);
  assert.match(mismatchedHead.stderr, /module checkout HEAD mismatch/);
  assert.deepEqual(head.curlCalls(), []);
});

test('host preflight refuses a symlinked or non-regular generator input', t => {
  const fixture = createFixture(t);
  const outside = path.join(fixture.root, 'outside-generator');
  fs.writeFileSync(outside, GENERATOR);
  fs.rmSync(path.join(fixture.srcPath, 'make_nvml'));
  fs.symlinkSync(outside, path.join(fixture.srcPath, 'make_nvml'));
  const result = fixture.runHostPrepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symlink/);
  assert.deepEqual(fixture.curlCalls(), []);
  assert.equal(fs.readFileSync(outside, 'utf8'), GENERATOR);
});

test('host preflight rejects generator bytes that differ from the pinned commit', t => {
  const dirty = createFixture(t);
  fs.appendFileSync(path.join(dirty.srcPath, 'make_nvml'), '# uncommitted edit\n');
  const modified = dirty.runHostPrepare();
  assert.notEqual(modified.status, 0);
  assert.match(modified.stderr, /does not match the pinned module commit/);
  assert.deepEqual(dirty.curlCalls(), []);
  assert.equal(fs.existsSync(dirty.headerPath), false);
  assert.equal(fs.existsSync(dirty.proofPath), false);

  const removed = createFixture(t);
  fs.rmSync(path.join(removed.srcPath, 'meson.build'));
  const deleted = removed.runHostPrepare();
  assert.notEqual(deleted.status, 0);
  assert.match(deleted.stderr, /missing module input/);
  assert.deepEqual(removed.curlCalls(), []);
  assert.equal(fs.existsSync(removed.proofPath), false);
});

test('container step revalidates the proof without reading Git metadata', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  fixture.denyGit();
  fixture.simulateDetachedGit();
  const dest = fixture.destDirectory('build-dll/src');
  const result = fixture.runPrepare({dests: [dest]});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fixture.gitCalls(), []);
  assert.equal(fixture.curlCalls().length, 1);
  assert.equal(fs.readFileSync(path.join(dest, `nvml_${FIXTURE_VERSION}.h`), 'utf8'), HEADER_BYTES.toString('utf8'));
});

test('version metadata comes from the validated proof without Git access', t => {
  const fixture = createFixture(t);
  const withoutProof = fixture.runVersion();
  assert.notEqual(withoutProof.status, 0);
  assert.match(withoutProof.stderr, /missing host NVML proof/);
  assert.equal(withoutProof.stdout, '');

  assert.equal(fixture.runHostPrepare().status, 0);
  fixture.denyGit();
  fixture.simulateDetachedGit();
  const version = fixture.runVersion();
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, ` ${fixture.moduleCommit} ${FIXTURE_MODULE}\n`);
  assert.deepEqual(fixture.gitCalls(), []);

  fixture.writeProof({...fixture.readProof(), moduleCommit: 'f'.repeat(40)});
  const tampered = fixture.runVersion();
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /another module commit/);
  assert.equal(tampered.stdout, '');
});

test('container step fails with the concrete host preflight when the proof is missing', t => {
  const fixture = createFixture(t);
  const result = fixture.runPrepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing host NVML proof/);
  assert.match(result.stderr, /host-prepare --source/);
  assert.ok(result.stderr.includes(fixture.proofPath));
  assert.deepEqual(fixture.curlCalls(), []);
  assert.equal(fs.existsSync(fixture.headerPath), false);
});

test('container step requires the verified canonical header and never downloads it', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  fs.rmSync(fixture.headerPath);
  const missing = fixture.runPrepare();
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing verified header/);
  assert.match(missing.stderr, /host-prepare --source/);
  assert.equal(fixture.curlCalls().length, 1);

  assert.equal(fixture.runHostPrepare().status, 0);
  const downloads = fixture.curlCalls().length;
  fs.writeFileSync(fixture.headerPath, TAMPERED_BYTES);
  const wrong = fixture.runPrepare();
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /SHA-256 mismatch/);
  assert.deepEqual(fs.readFileSync(fixture.headerPath), TAMPERED_BYTES);
  assert.equal(fixture.curlCalls().length, downloads);
});

test('container step rejects a proof bound to another source, lock, version or header', t => {
  const cases = [
    ['another source path', proof => ({...proof, sourcePath: '/elsewhere/repo'}), /another source path/],
    ['another resolved source root', proof => ({...proof, sourceRoot: '/elsewhere/repo'}), /another resolved source root/],
    ['another module commit', proof => ({...proof, moduleCommit: 'f'.repeat(40)}), /another module commit/],
    ['another module head', proof => ({...proof, moduleHead: 'f'.repeat(40)}), /another module checkout HEAD/],
    ['another version', proof => ({...proof, version: '1.2.3'}), /another version/],
    ['another lock hash', proof => ({...proof, lockSha256: '0'.repeat(64)}), /audited lock changed/],
    ['another header identity', proof => ({...proof, header: {...proof.header, sha256: '0'.repeat(64)}}), /another header identity/],
    ['another header path', proof => ({...proof, header: {...proof.header, path: 'elsewhere/nvml.h'}}), /another header path/],
    ['missing generator entries', proof => ({...proof, generator: proof.generator.slice(1)}), /does not bind the module generator inputs/],
    ['duplicate generator entry', proof => ({...proof, generator: [proof.generator[0], proof.generator[0], proof.generator[2]]}), /unexpected generator input/],
    ['another generator hash', proof => ({...proof, generator: proof.generator.map((entry, index) => index === 0 ? {...entry, sha256: '0'.repeat(64)} : entry)}), /changed after the host preflight/],
    ['another schema', proof => ({...proof, schema: 2}), /unsupported proof schema/],
  ];
  for (const [label, mutate, expected] of cases) {
    const fixture = createFixture(t);
    assert.equal(fixture.runHostPrepare().status, 0);
    fixture.writeProof(mutate(fixture.readProof()));
    const result = fixture.runPrepare();
    assert.notEqual(result.status, 0, label);
    assert.match(result.stderr, expected, label);
    assert.equal(fixture.curlCalls().length, 1, label);
  }
});

test('container step rejects module inputs that changed after the host preflight', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  fs.appendFileSync(path.join(fixture.moduleRoot, 'meson.build'), '# changed\n');
  const result = fixture.runPrepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /meson\.build changed after the host preflight/);
  assert.equal(fixture.curlCalls().length, 1);
});

test('container step rejects an audited lock changed after the host preflight', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const lock = JSON.parse(fs.readFileSync(fixture.lockPath, 'utf8'));
  lock.declaredBy = 'edited later';
  fs.writeFileSync(fixture.lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  const result = fixture.runPrepare();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /audited lock changed after the host preflight/);
  assert.equal(fixture.curlCalls().length, 1);
});

test('container step reuses a verified destination and refuses a wrong one', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const good = fixture.destDirectory('build-so/src');
  fs.writeFileSync(path.join(good, `nvml_${FIXTURE_VERSION}.h`), HEADER_BYTES);
  const reused = fixture.runPrepare({dests: [good]});
  assert.equal(reused.status, 0, reused.stderr);
  assert.equal(fs.readFileSync(path.join(good, `nvml_${FIXTURE_VERSION}.h`), 'utf8'), HEADER_BYTES.toString('utf8'));

  const bad = fixture.destDirectory('build-bad/src');
  const badFile = path.join(bad, `nvml_${FIXTURE_VERSION}.h`);
  fs.writeFileSync(badFile, TAMPERED_BYTES);
  const rejected = fixture.runPrepare({dests: [bad]});
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /SHA-256 mismatch/);
  assert.deepEqual(fs.readFileSync(badFile), TAMPERED_BYTES);
});

test('container step validates every destination before the first copy', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const valid = fixture.destDirectory('build-first/src');
  const outside = path.join(fixture.root, 'outside-dest');
  fs.mkdirSync(outside, {recursive: true});
  const symlinked = path.join(fixture.root, 'later-dest');
  fs.symlinkSync(outside, symlinked);
  const result = fixture.runPrepare({dests: [valid, symlinked]});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--dest traverses a symlink/);
  assert.deepEqual(fs.readdirSync(valid), [], 'the first destination must stay untouched');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(fixture.leftovers(), []);
});

test('prepare and version reject a version that differs from the audited lock', t => {
  const fixture = createFixture(t);
  const beforeProof = [() => fixture.runPrepare({version: '1.2.3'}), () => fixture.runVersion({version: '1.2.3'})];
  for (const run of beforeProof) {
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the pinned/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(fixture.curlCalls(), []);
  assert.deepEqual(fixture.gitCalls(), []);
  assert.equal(fs.existsSync(fixture.proofPath), false);
  assert.equal(fs.existsSync(fixture.headerPath), false);

  // The reported repro: a valid proof is present, so only the version equality
  // check can reject the wrong version for both modes.
  assert.equal(fixture.runHostPrepare().status, 0);
  const dest = fixture.destDirectory('dest/src');
  for (const run of [
    () => fixture.runPrepare({version: '1.2.3', dests: [dest]}),
    () => fixture.runVersion({version: '1.2.3'}),
  ]) {
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /differs from the pinned/);
    assert.equal(result.stdout, '');
  }
  assert.deepEqual(fs.readdirSync(dest), []);
});

test('container step preflights every existing target before the first copy', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const first = fixture.destDirectory('first-empty/src');
  const headerName = `nvml_${FIXTURE_VERSION}.h`;

  const symlinkDest = fixture.destDirectory('second-symlink/src');
  const outside = path.join(fixture.root, 'outside-header');
  fs.writeFileSync(outside, HEADER_BYTES);
  fs.symlinkSync(outside, path.join(symlinkDest, headerName));
  const symlinked = fixture.runPrepare({dests: [first, symlinkDest]});
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /refusing to use a symlink/);
  assert.deepEqual(fs.readdirSync(first), [], 'the first destination must stay untouched');
  assert.ok(fs.lstatSync(path.join(symlinkDest, headerName)).isSymbolicLink());
  assert.deepEqual(fs.readFileSync(outside), HEADER_BYTES);

  const wrongDest = fixture.destDirectory('second-wrong/src');
  const wrongFile = path.join(wrongDest, headerName);
  fs.writeFileSync(wrongFile, TAMPERED_BYTES);
  const wrong = fixture.runPrepare({dests: [first, wrongDest]});
  assert.notEqual(wrong.status, 0);
  assert.match(wrong.stderr, /SHA-256 mismatch/);
  assert.deepEqual(fs.readdirSync(first), [], 'the first destination must stay untouched');
  assert.deepEqual(fs.readFileSync(wrongFile), TAMPERED_BYTES);

  const cachedDest = fixture.destDirectory('second-cached/src');
  fs.writeFileSync(path.join(cachedDest, headerName), HEADER_BYTES);
  const cached = fixture.runPrepare({dests: [first, cachedDest]});
  assert.equal(cached.status, 0, cached.stderr);
  assert.equal(fs.readFileSync(path.join(first, headerName), 'utf8'), HEADER_BYTES.toString('utf8'));
  assert.equal(fs.readFileSync(path.join(cachedDest, headerName), 'utf8'), HEADER_BYTES.toString('utf8'));
  assert.deepEqual(fixture.leftovers(), []);
});

test('path validation refuses traversal, symlinked ancestors and symlinked files before mutating', t => {
  const outsideWrite = (fixture, name, content = 'outside sentinel\n') => {
    const directory = path.join(fixture.root, name);
    fs.mkdirSync(directory, {recursive: true});
    const file = path.join(directory, 'sentinel');
    fs.writeFileSync(file, content);
    return {directory, file};
  };

  const traversal = createFixture(t);
  const relative = traversal.runHostPrepare({source: 'repo'});
  assert.notEqual(relative.status, 0);
  assert.match(relative.stderr, /must be an absolute path/);

  const dotted = traversal.runHostPrepare({source: `${traversal.repo}/../repo`});
  assert.notEqual(dotted.status, 0);
  assert.match(dotted.stderr, /relative path component/);

  const dottedProof = traversal.runHostPrepare({proof: `${traversal.root}/build/../proof.json`});
  assert.notEqual(dottedProof.status, 0);
  assert.match(dottedProof.stderr, /relative path component/);

  const unknownSource = traversal.runHostPrepare({source: path.join(traversal.root, 'missing-repo')});
  assert.notEqual(unknownSource.status, 0);
  assert.match(unknownSource.stderr, /does not resolve/);

  const srcLink = createFixture(t);
  const srcOutside = outsideWrite(srcLink, 'outside-src');
  srcLink.linkSourceDirectory(srcOutside.directory);
  const symlinkedSrc = srcLink.runHostPrepare();
  assert.notEqual(symlinkedSrc.status, 0);
  assert.match(symlinkedSrc.stderr, /traverses a symlink/);
  assert.equal(fs.readFileSync(srcOutside.file, 'utf8'), 'outside sentinel\n');
  assert.deepEqual(fs.readdirSync(srcOutside.directory).sort(), ['sentinel']);

  const lockLink = createFixture(t);
  const lockOutside = outsideWrite(lockLink, 'outside-lock');
  fs.writeFileSync(path.join(lockOutside.directory, 'nvml-header.lock.json'), fs.readFileSync(lockLink.lockPath));
  fs.rmSync(lockLink.lockPath);
  fs.symlinkSync(path.join(lockOutside.directory, 'nvml-header.lock.json'), lockLink.lockPath);
  const symlinkedLock = lockLink.runHostPrepare();
  assert.notEqual(symlinkedLock.status, 0);
  assert.match(symlinkedLock.stderr, /the audited lock is a symlink/);
  assert.equal(fs.readFileSync(lockOutside.file, 'utf8'), 'outside sentinel\n');

  const lockParentLink = createFixture(t);
  const lockParentOutside = outsideWrite(lockParentLink, 'outside-nexus');
  fs.writeFileSync(path.join(lockParentOutside.directory, 'nvml-header.lock.json'), fs.readFileSync(lockParentLink.lockPath));
  fs.rmSync(path.join(lockParentLink.repo, 'nexus'), {recursive: true});
  fs.symlinkSync(lockParentOutside.directory, path.join(lockParentLink.repo, 'nexus'));
  const symlinkedLockParent = lockParentLink.runHostPrepare();
  assert.notEqual(symlinkedLockParent.status, 0);
  assert.match(symlinkedLockParent.stderr, /the audited lock traverses a symlink/);
  assert.equal(fs.readFileSync(lockParentOutside.file, 'utf8'), 'outside sentinel\n');

  const proofLink = createFixture(t);
  const proofOutside = outsideWrite(proofLink, 'outside-proof');
  fs.rmSync(proofLink.proofPath, {force: true});
  fs.symlinkSync(path.join(proofOutside.directory, 'proof.json'), proofLink.proofPath);
  const symlinkedProof = proofLink.runHostPrepare();
  assert.notEqual(symlinkedProof.status, 0);
  assert.match(symlinkedProof.stderr, /--proof is a symlink/);
  assert.equal(fs.readFileSync(proofOutside.file, 'utf8'), 'outside sentinel\n');

  const destLink = createFixture(t);
  assert.equal(destLink.runHostPrepare().status, 0);
  const destOutside = outsideWrite(destLink, 'outside-dest');
  const destLinkPath = path.join(destLink.root, 'dest-link');
  fs.symlinkSync(destOutside.directory, destLinkPath);
  const symlinkedDest = destLink.runPrepare({dests: [destLinkPath]});
  assert.notEqual(symlinkedDest.status, 0);
  assert.match(symlinkedDest.stderr, /--dest traverses a symlink/);
  assert.equal(fs.readFileSync(destOutside.file, 'utf8'), 'outside sentinel\n');
  assert.deepEqual(fs.readdirSync(destOutside.directory).sort(), ['sentinel']);

  const destMissing = destLink.runPrepare({dests: [path.join(destLink.root, 'missing/dest')]});
  assert.notEqual(destMissing.status, 0);
  assert.match(destMissing.stderr, /is missing|parent is missing/);
});

test('concurrent host preflight performs a single verified download', async t => {
  const fixture = createFixture(t, {delayMs: 400});
  const results = await Promise.all([fixture.runHostPrepareAsync(), fixture.runHostPrepareAsync()]);
  for (const result of results) assert.equal(result.status, 0, result.stderr);
  assert.equal(fixture.curlCalls().length, 1);
  assert.equal(sha256(fs.readFileSync(fixture.headerPath)), sha256(HEADER_BYTES));
  assert.deepEqual(fixture.leftovers(), []);
});

test('a failed or corrupt host download leaves no partial header', t => {
  const failure = createFixture(t, {mode: 'http-error'});
  const failed = failure.runHostPrepare();
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /download failed/);
  assert.equal(fs.existsSync(failure.headerPath), false);
  assert.equal(fs.existsSync(failure.proofPath), false);
  assert.deepEqual(failure.leftovers(), []);

  const corrupt = createFixture(t, {mode: 'corrupt'});
  const tampered = corrupt.runHostPrepare();
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stderr, /SHA-256 mismatch/);
  assert.equal(fs.existsSync(corrupt.headerPath), false);
  assert.equal(fs.existsSync(corrupt.proofPath), false);
  assert.deepEqual(corrupt.leftovers(), []);
});

test('the verified header stays in the module source tree for archiving', t => {
  const fixture = createFixture(t);
  assert.equal(fixture.runHostPrepare().status, 0);
  const relative = path.relative(fixture.repo, fixture.headerPath).split(path.sep).join('/');
  assert.equal(relative, `${FIXTURE_MODULE}/src/nvml_${FIXTURE_VERSION}.h`);
  const archive = path.join(fixture.root, 'source.tar');
  const created = spawnSync('tar', ['-cf', archive, '-C', fixture.repo, '.'], {encoding: 'utf8'});
  assert.equal(created.status, 0, created.stderr);
  const listing = spawnSync('tar', ['-tf', archive], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024});
  assert.equal(listing.status, 0, listing.stderr);
  assert.ok(listing.stdout.split('\n').includes(`./${relative}`));
});

test('the audited lock pins the immutable header and its parent module commit', () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(lock.schema, 1);
  assert.equal(lock.component, 'wine-nvml');
  assert.equal(lock.variant, 'nexus-cachyos');
  assert.equal(lock.module, 'nvidia-libs/wine-nvml');
  assert.equal(lock.moduleCommit, 'a1a7d8fac0e054122cbaf9205c9bee33f5831015');
  assert.equal(lock.name, 'nvml.h');
  assert.equal(lock.version, '610.43.02');
  assert.equal(lock.declaredTag, lock.version);
  assert.equal(lock.repository, 'https://github.com/NVIDIA/nvidia-settings');
  assert.equal(lock.commit, '5b341a9e54f08ac324e148e1e7e102030e42b1c4');
  assert.equal(lock.url, `https://raw.githubusercontent.com/NVIDIA/nvidia-settings/${lock.commit}/src/nvml.h`);
  assert.equal(lock.sha256, '31a26e3ce6f0b98a76cea38a3cf28aa112a20cfb37e9057786c768712d6a487f');
  assert.equal(lock.bytes, 795795);
  assert.equal(lock.gitBlobSha1, '43c908fade9d5516e9ffc61a266b891f51ccc0fe');
});

test('the lock module commit matches the checked out parent Git link', () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const tree = git(repository, 'ls-tree', 'HEAD', '--', lock.module);
  assert.equal(tree, `160000 commit ${lock.moduleCommit}\t${lock.module}`);
});

test('the wine-nvml rule requires the host proof and passes the version explicitly', () => {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const text = fs.readFileSync(makefilePath, 'utf8');
  assert.match(text, new RegExp(`^NVML_VERSION = ${lock.version.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(text, /^NVML_HEADER_LOCK = \$\(SRCDIR\)\/nexus\/nvml-header\.lock\.json$/m);
  assert.match(text, /^NVML_HEADER_PREPARE = \$\(SRCDIR\)\/nexus\/prepare-nvml-header\.sh$/m);
  assert.match(text, /^NVML_HEADER_PROOF = \$\(OBJ\)\/nvml-header-proof\.json$/m);
  assert.doesNotMatch(text, /git\b/, 'the container rule must not query Git');
  for (const target of ['NVML_SO_SRC', 'NVML_DLL_SRC']) {
    assert.match(
      text,
      new RegExp(`^\\t\\$\\(NVML_HEADER_PREPARE\\) prepare --source \\$\\(SRCDIR\\) --version \\$\\(NVML_VERSION\\) --proof \\$\\(NVML_HEADER_PROOF\\) --dest \\$\\(${target}\\)/src$`, 'm'),
      target,
    );
    assert.match(text, new RegExp(`^\\tcd \\$\\(${target}\\)/src && \\./make_nvml \\$\\(NVML_VERSION\\)$`, 'm'), target);
    assert.match(
      text,
      new RegExp(`^\\t\\$\\(NVML_HEADER_PREPARE\\) version --source \\$\\(SRCDIR\\) --version \\$\\(NVML_VERSION\\) --proof \\$\\(NVML_HEADER_PROOF\\) > \\$\\(DST_LIBDIR\\)/wine/nvidia-libs/nvml/version$`, 'm'),
      target,
    );
  }
  assert.equal((text.match(/\.\/make_nvml \S*\$\(NVML_VERSION\)/g) || []).length, 2);
  assert.equal((text.match(/\$\(NVML_HEADER_PREPARE\) version /g) || []).length, 2);
  assert.doesNotMatch(text, /\.\/make_nvml\s*$/m);
  assert.ok(fs.statSync(helperPath).mode & 0o111);
});

test('the host preflight guard parses the exact prepared module path', () => {
  const pin = 'a'.repeat(40);
  assert.equal(NVML_MODULE_PATH, 'nvidia-libs/wine-nvml');
  for (const line of [
    ` ${pin} nvidia-libs/wine-nvml`,
    ` ${pin} nvidia-libs/wine-nvml (v0.4)`,
    ` ${pin} nvidia-libs/wine-nvml (heads/main)`,
    ` ${pin} nvidia-libs/wine-nvml (v0.4-3-gabc1234)`,
  ]) assert.equal(nvmlPreflightRequired([line]), true, line);
  for (const line of [
    ` ${pin} nvidia-libs/wine-nvml-extra`,
    ` ${pin} nvidia-libs/wine-nvml/child`,
    ` ${pin} something/nvidia-libs/wine-nvml`,
    ` ${pin} other nvidia-libs/wine-nvml`,
    ` ${pin} wine-nvml`,
    ` ${pin} vkd3d`,
    `+${pin} nvidia-libs/wine-nvml`,
    `-${pin} nvidia-libs/wine-nvml`,
    `nvidia-libs/wine-nvml`,
    ` ${pin}  nvidia-libs/wine-nvml`,
    ` ${pin.slice(1)} nvidia-libs/wine-nvml`,
  ]) assert.equal(nvmlPreflightRequired([line]), false, line);
  assert.equal(nvmlPreflightRequired([]), false);
  assert.equal(nvmlPreflightRequired(['abc vkd3d-proton', ` ${pin} nvidia-libs/wine-nvml (heads/main)`]), true);
  assert.throws(() => nvmlPreflightRequired('not a list'));
  assert.throws(() => nvmlPreflightRequired([42]));
});

test('the host preflight runs after the source checks and before the first SDK recipe', () => {
  const text = fs.readFileSync(buildRuntimePath, 'utf8');
  const preflight = "'host-prepare','--source',source,'--proof',path.join(build,'nvml-header-proof.json')";
  const call = `run(nvmlHelper,[${preflight}],build)`;
  assert.equal((text.match(/host-prepare/g) || []).length, 1);
  assert.ok(text.includes(call), 'the bounded host preflight call is missing');
  const callIndex = text.indexOf(call);
  const sourceCheckIndex = text.indexOf("'Prepared HTTP header mismatch'");
  const firstRecipeIndex = text.indexOf('for(const stage of sdkBuildPlan(');
  assert.ok(sourceCheckIndex >= 0 && firstRecipeIndex > sourceCheckIndex);
  assert.ok(callIndex > sourceCheckIndex, 'the preflight must follow the strict source checks');
  assert.ok(callIndex < firstRecipeIndex, 'the preflight must precede the first SDK recipe');
  // The module plan decides whether the preflight is required. The guard parses
  // the exact module path from each prepared entry, so a trailing submodule
  // description cannot hide the module, and a missing audited input is a hard
  // error instead of a silent skip.
  assert.ok(text.includes("import {nvmlPreflightRequired} from './nvml-preflight.mjs';"));
  assert.ok(text.includes('if(nvmlPreflightRequired(graph.submodules)){'));
  assert.doesNotMatch(text, /\.endsWith\(/);
  assert.ok(text.includes("await fs.access(input).catch(()=>{throw Error('Pinned NVML module requires its audited host preflight input: '+input);})"));
  assert.doesNotMatch(text, /fs\.access\(path\.join\(source,'nexus\/nvml-header\.lock\.json'\)\)/);
  assert.ok(text.includes('Output already exists'));
});

test('the helper never downloads without a checksum and never weakens TLS', () => {
  const text = fs.readFileSync(helperPath, 'utf8');
  assert.ok(text.includes("--proto '=https'"));
  assert.ok(text.includes("--proto-redir '=https'"));
  assert.ok(text.includes('--max-filesize'));
  assert.ok(text.includes('sha256sum'));
  assert.doesNotMatch(text, /--insecure/);
  assert.doesNotMatch(text, /curl[^\n]*(?:\s-k\b|-Ok\b|--no-check-certificate)/);
  assert.doesNotMatch(text, /NVML_[A-Z_]*(?:URL|SHA|COMMIT|VERSION)/, 'no environment override of a pin');
  // The download sits inside the host branch only, and the container branch
  // refuses a missing header with the host preflight command.
  assert.ok(text.indexOf('curl --fail') < text.indexOf('for dest in'));
  assert.match(text, /missing verified header/);
  assert.match(text, /never download/);
});

test('a real linked worktree with external Git metadata builds from the host proof', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-nvml-worktree-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const moduleOrigin = path.join(root, 'module-origin');
  const parentOrigin = path.join(root, 'parent-origin');
  const worktree = path.join(root, 'worktree');
  fs.mkdirSync(path.join(moduleOrigin, 'src'), {recursive: true});
  for (const [relative, body] of Object.entries(GENERATOR_INPUTS)) fs.writeFileSync(path.join(moduleOrigin, relative), body);
  fs.writeFileSync(path.join(moduleOrigin, 'src/.gitignore'), 'nvml_*.h\n');
  git(moduleOrigin, 'init', '-q');
  git(moduleOrigin, 'add', '-A');
  git(moduleOrigin, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'module');
  const moduleCommit = git(moduleOrigin, 'rev-parse', 'HEAD');

  fs.mkdirSync(path.join(parentOrigin, 'nexus'), {recursive: true});
  git(parentOrigin, 'init', '-q');
  const lock = fixtureLock(moduleCommit);
  fs.writeFileSync(path.join(parentOrigin, 'nexus/nvml-header.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  git(parentOrigin, 'add', 'nexus/nvml-header.lock.json');
  git(parentOrigin, 'update-index', '--add', '--cacheinfo', `160000,${moduleCommit},${FIXTURE_MODULE}`);
  git(parentOrigin, '-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '-m', 'parent');

  git(parentOrigin, 'worktree', 'add', '--detach', worktree);
  // The module checkout is its own linked worktree, so its metadata lives
  // outside the parent worktree exactly like the container mount view.
  fs.rmSync(path.join(worktree, ...FIXTURE_MODULE.split('/')), {recursive: true, force: true});
  git(moduleOrigin, 'worktree', 'add', '--detach', path.join(worktree, ...FIXTURE_MODULE.split('/')), moduleCommit);
  fs.mkdirSync(path.join(root, 'build'), {recursive: true});
  assert.ok(fs.lstatSync(path.join(worktree, '.git')).isFile(), 'the fixture must be a linked worktree');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const payload = path.join(root, 'payload.bin');
  fs.writeFileSync(payload, HEADER_BYTES);
  const config = path.join(root, 'curl.json');
  const curlLog = path.join(root, 'curl.log');
  fs.writeFileSync(config, JSON.stringify({log: curlLog, payload, mode: 'ok', delayMs: 0}));
  fs.writeFileSync(path.join(bin, 'curl'), fakeCurlSource(), {mode: 0o755});
  const env = {...process.env, PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, NVML_TEST_CURL_CONFIG: config};
  const args = [helperPath, 'host-prepare', '--source', worktree, '--proof', path.join(root, 'build/nvml-header-proof.json')];
  const host = spawnSync('bash', args, {encoding: 'utf8', env});
  assert.equal(host.status, 0, host.stderr);
  const proof = JSON.parse(fs.readFileSync(path.join(root, 'build/nvml-header-proof.json'), 'utf8'));
  assert.equal(proof.moduleHead, moduleCommit);
  assert.equal(proof.sourceRoot, fs.realpathSync(worktree));
  assert.equal(git(worktree, 'status', '--porcelain', '--untracked-files=all'), '');
  // Simulate the container mount view: no Git metadata inside the mounted tree.
  fs.renameSync(path.join(worktree, '.git'), path.join(root, 'detached-parent-git'));
  fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: /unmounted/parent/.git/worktrees/worktree\n');
  fs.writeFileSync(path.join(bin, 'git'), fakeDeniedGitSource(), {mode: 0o755});
  const dest = path.join(root, 'container-src/src');
  fs.mkdirSync(dest, {recursive: true});
  const container = spawnSync('bash', [helperPath, 'prepare', '--source', worktree, '--version', lock.version, '--proof', path.join(root, 'build/nvml-header-proof.json'), '--dest', dest], {encoding: 'utf8', env});
  assert.equal(container.status, 0, container.stderr);
  const version = spawnSync('bash', [helperPath, 'version', '--source', worktree, '--version', lock.version, '--proof', path.join(root, 'build/nvml-header-proof.json')], {encoding: 'utf8', env});
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout, ` ${moduleCommit} ${FIXTURE_MODULE}\n`);
  assert.equal(fs.existsSync(path.join(root, 'git.log')), false, 'the container step must not read Git');
  assert.equal(fs.readFileSync(path.join(dest, `nvml_${lock.version}.h`), 'utf8'), HEADER_BYTES.toString('utf8'));
  assert.equal(fs.readFileSync(curlLog, 'utf8').trim().split('\n').length, 1);
});

test('the pinned bytes match a local real header fixture when provided', t => {
  const fixture = process.env.NVML_HEADER_FIXTURE;
  if (!fixture) {
    t.skip('NVML_HEADER_FIXTURE is not set');
    return;
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const bytes = fs.readFileSync(fixture);
  assert.equal(bytes.length, lock.bytes);
  assert.equal(sha256(bytes), lock.sha256);
});
