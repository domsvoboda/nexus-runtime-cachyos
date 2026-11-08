// SPDX-License-Identifier: MIT
// Focused regression for the meson-wine tool PATH.
//
// The generic environment assigns the declared HOST_DEPENDS tool directories to
// PATH first, and rules-meson-wine then adds another PATH assignment for the
// target wine bin. Environment assignments do not chain, so the later one used
// to win and the host dependency directories were dropped. Cross-arch targets
// have no compiler of their own: winegcc is built only for the host
// architecture, so a target-only PATH cannot configure a cross winelib module.
//
// This test instantiates the real make/utility.mk, make/rules-common.mk and
// make/rules-meson-wine.mk with GNU make, distinct fake host and target bins and
// a sentinel host winegcc. The legacy assignment control reproduces the pre-fix
// behaviour with the exact former late PATH statement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function executable(file, marker) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' '${marker}'\n`, {mode: 0o755});
}

function spawnMake(cwd, makefile, target, environment) {
  // Absolute make path: the recipe PATH is a private fixture directory that
  // must not inherit the host tool directories (the host may ship its own
  // winegcc, which must not mask the sentinels under test).
  const makeBinary = process.env.NEXUS_MAKE_BINARY || '/usr/bin/make';
  assert.ok(fs.existsSync(makeBinary), `missing GNU make: ${makeBinary}`);
  return spawnSync(makeBinary, ['-s', '-f', makefile, target], {
    cwd,
    encoding: 'utf8',
    timeout: 120000,
    env: {...process.env, ...environment},
  });
}

function parseMakeValues(stdout) {
  const values = {};
  for (const line of stdout.split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function runMake(cwd, makefile, target, environment) {
  const result = spawnMake(cwd, makefile, target, environment);
  assert.equal(result.status, 0, `make ${target} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return parseMakeValues(result.stdout);
}

function runMakeFailure(cwd, makefile, target, environment, expected) {
  const result = spawnMake(cwd, makefile, target, environment);
  assert.notEqual(result.status, 0, `make ${target} unexpectedly succeeded:\n${result.stdout}`);
  assert.match(result.stderr, expected);
  return result;
}

function pathPositions(value, entries) {
  const parts = value.split(':');
  return entries.map(entry => {
    const index = parts.indexOf(entry);
    assert.notEqual(index, -1, `PATH does not contain ${entry}: ${value}`);
    return index;
  });
}

function commonFixture(fixture, hostBin, targetBin, otherBin) {
  return [
    `SRC := ${repository}`,
    `FIXTURE := ${fixture}`,
    `OBJ := ${path.join(fixture, 'obj')}`,
    'HOST_ARCH := x86_64',
    'ARCHS := i386-unix i386-windows x86_64-unix x86_64-windows',
    'J := 1',
    'include $(SRC)/make/utility.mk',
    'include $(SRC)/make/rules-common.mk',
    `WINE_x86_64_DST := ${path.join(fixture, 'wine-x86_64')}`,
    `WINE_x86_64_BINDIR := ${hostBin}`,
    `WINE_i386_DST := ${path.join(fixture, 'wine-i386')}`,
    `OTHERDEP_x86_64_BINDIR := ${otherBin}`,
    `DEMO_SRC := ${path.join(fixture, 'src')}`,
    'DEMO_HOST_DEPENDS := wine otherdep',
  ];
}

function probeRecipe(environment) {
  const probes = {
    WINEGCC: 'command -v winegcc || echo MISSING',
    WINEGCC_OUT: 'winegcc 2>/dev/null || echo MISSING',
    WINEBOOT_OUT: 'wineboot 2>/dev/null || echo MISSING',
    TARGETTOOL: 'command -v targettool || echo MISSING',
    OTHERTOOL: 'command -v othertool || echo MISSING',
    BASETOOL: 'command -v basetool || echo MISSING',
  };
  const body = Object.entries(probes)
    .map(([name, command]) => `printf "${name}=%s\\n" "$$(${command})";`)
    .join(' ');
  return `\t@env $(${environment}) sh -c '${body} printf "PATH=%s\\n" "$$PATH"'`;
}

function fakeBins(fixture) {
  const hostBin = path.join(fixture, 'wine-x86_64', 'bin');
  const targetBin = path.join(fixture, 'wine-i386', 'bin');
  const otherBin = path.join(fixture, 'otherdep', 'bin');
  const baseBin = path.join(fixture, 'basebin');
  executable(path.join(hostBin, 'winegcc'), 'host-winegcc');
  executable(path.join(hostBin, 'wineboot'), 'host-wineboot');
  executable(path.join(targetBin, 'wineboot'), 'target-wineboot');
  executable(path.join(targetBin, 'targettool'), 'target-tool');
  executable(path.join(otherBin, 'othertool'), 'other-tool');
  executable(path.join(baseBin, 'basetool'), 'base-tool');
  // Private inherited PATH: only the utilities the make recipe itself needs.
  // No host wine tools, so the sentinels are the only candidates under test.
  for (const [name, candidates] of Object.entries({
    env: ['/usr/bin/env', '/bin/env'],
    sh: ['/bin/sh', '/usr/bin/sh'],
    mkdir: ['/usr/bin/mkdir', '/bin/mkdir'],
  })) {
    const source = candidates.find(candidate => fs.existsSync(candidate));
    assert.ok(source, `missing required fixture utility: ${name}`);
    fs.symlinkSync(source, path.join(baseBin, name));
  }
  return {hostBin, targetBin, otherBin, baseBin};
}

test('meson-wine keeps host dependency tools for cross and native targets', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meson-wine-'));
  t.after(() => fs.rmSync(fixture, {recursive: true, force: true}));
  const {hostBin, targetBin, otherBin, baseBin} = fakeBins(fixture);

  const makefile = path.join(fixture, 'fixture.mk');
  fs.writeFileSync(
    makefile,
    [
      ...commonFixture(fixture, hostBin, targetBin, otherBin),
      'include $(SRC)/make/rules-meson-wine.mk',
      '$(eval $(call rules-meson-wine,demo,i386,windows))',
      '$(eval $(call rules-meson-wine,demo,x86_64,windows))',
      'check-i386:',
      probeRecipe('DEMO_i386_ENV'),
      'check-x86_64:',
      probeRecipe('DEMO_x86_64_ENV'),
    ].join('\n') + '\n',
  );

  const environment = {PATH: baseBin};

  // Cross i386 target: no winegcc of its own, so the sentinel compiler in the
  // host dependency directory resolves. The target wine bin stays first, the
  // other declared host dependency and the inherited PATH are retained.
  const cross = runMake(fixture, makefile, 'check-i386', environment);
  assert.equal(cross.WINEGCC, path.join(hostBin, 'winegcc'));
  assert.equal(cross.WINEGCC_OUT, 'host-winegcc');
  assert.equal(cross.WINEBOOT_OUT, 'target-wineboot', 'target wine tool selection changed');
  assert.equal(cross.TARGETTOOL, path.join(targetBin, 'targettool'));
  assert.equal(cross.OTHERTOOL, path.join(otherBin, 'othertool'), 'declared HOST_DEPENDS tool lost');
  assert.equal(cross.BASETOOL, path.join(baseBin, 'basetool'), 'inherited PATH lost');
  const [targetIndex, hostIndex, otherIndex, baseIndex] = pathPositions(cross.PATH, [targetBin, hostBin, otherBin, baseBin]);
  assert.ok(targetIndex < hostIndex, 'target wine bin must stay first for target tool selection');
  assert.ok(hostIndex < otherIndex && otherIndex < baseIndex, 'host dependencies must precede the inherited PATH');

  // Native x86_64 target: host dependency and target wine bin are the same
  // reviewed wine directory, and the other host dependency and base PATH stay.
  const native = runMake(fixture, makefile, 'check-x86_64', environment);
  assert.equal(native.WINEGCC, path.join(hostBin, 'winegcc'));
  assert.equal(native.WINEGCC_OUT, 'host-winegcc');
  assert.equal(native.WINEBOOT_OUT, 'host-wineboot');
  assert.equal(native.OTHERTOOL, path.join(otherBin, 'othertool'));
  assert.equal(native.BASETOOL, path.join(baseBin, 'basetool'));
  assert.equal(native.TARGETTOOL, 'MISSING');
  const [nativeHostIndex, nativeOtherIndex, nativeBaseIndex] = pathPositions(native.PATH, [hostBin, otherBin, baseBin]);
  assert.ok(nativeHostIndex < nativeOtherIndex && nativeOtherIndex < nativeBaseIndex);
});

test('legacy late PATH assignment reproduced the cross-arch winegcc failure', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meson-wine-legacy-'));
  t.after(() => fs.rmSync(fixture, {recursive: true, force: true}));
  const {hostBin, targetBin, otherBin, baseBin} = fakeBins(fixture);

  const makefile = path.join(fixture, 'legacy.mk');
  fs.writeFileSync(
    makefile,
    [
      ...commonFixture(fixture, hostBin, targetBin, otherBin),
      '$(eval $(call create-rules-common,demo,DEMO,i386,windows))',
      // Exact late PATH assignment as the pre-fix production rule emitted it
      // into makefile text after its macro expansion.
      'DEMO_i386_ENV += PATH="$(WINE_i386_DST)/bin:$$PATH"',
      'check:',
      probeRecipe('DEMO_i386_ENV'),
    ].join('\n') + '\n',
  );

  const values = runMake(fixture, makefile, 'check', {PATH: baseBin});
  assert.equal(values.WINEGCC, 'MISSING', 'legacy PATH control should not find winegcc');
  assert.equal(values.OTHERTOOL, 'MISSING', 'legacy PATH control should lose host dependency tools');
  assert.equal(values.TARGETTOOL, path.join(targetBin, 'targettool'));
  assert.equal(values.BASETOOL, path.join(baseBin, 'basetool'));
  assert.ok(values.PATH.split(':').includes(targetBin), 'legacy PATH should contain the target wine bin');
  assert.ok(!values.PATH.split(':').includes(hostBin), 'legacy PATH should not contain the host wine tools');
});

test('meson-wine adds the target-arch wine unix archives through a generated cross file', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meson-wine-cross-'));
  t.after(() => fs.rmSync(fixture, {recursive: true, force: true}));

  const wineCross = path.join(fixture, 'cross-wine.txt');
  const mingwCross = path.join(fixture, 'cross-mingw.txt');
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m32', '-mwindows']\n");
  fs.writeFileSync(mingwCross, "[binaries]\nc = ['winegcc', '-b', 'x86_64-w64-mingw32']\n\n[built-in options]\nc_link_args = ['-mno-cygwin']\n");

  const makefile = path.join(fixture, 'cross.mk');
  fs.writeFileSync(
    makefile,
    [
      `SRC := ${repository}`,
      `FIXTURE := ${fixture}`,
      `OBJ := ${path.join(fixture, 'obj')}`,
      'HOST_ARCH := x86_64',
      'ARCHS := i386-unix i386-windows',
      'J := 1',
      'include $(SRC)/make/utility.mk',
      'include $(SRC)/make/rules-common.mk',
      'include $(SRC)/make/rules-meson-wine.mk',
      `WINE_i386_DST := ${path.join(fixture, 'wine-i386')}`,
      `WINE_i386_BINDIR := ${path.join(fixture, 'wine-i386', 'bin')}`,
      `DEMO_SRC := ${path.join(fixture, 'src')}`,
      'DEMO_HOST_DEPENDS := wine',
      `DEMO_i386_MESON_ARGS = --cross-file=${wineCross} --libdir=lib/demo`,
      '$(eval $(call rules-meson-wine,demo,i386,windows))',
      `MINGW_SRC := ${path.join(fixture, 'mingwsrc')}`,
      'MINGW_HOST_DEPENDS := wine',
      `MINGW_i386_MESON_ARGS = --cross-file=${mingwCross} --libdir=lib/mingw`,
      '$(eval $(call rules-meson-wine,mingw,i386,windows))',
      `$(OBJ)/.demo-post-source $(OBJ)/.mingw-post-source:`,
      '\t@mkdir -p $(OBJ)',
      '\t@touch $@',
      `check-cross: $(OBJ)/.demo-i386-cross-wine.txt $(OBJ)/.mingw-i386-cross-wine.txt`,
      '\t@printf "WINE=%s\\n" "$$(grep \'^c_link_args\' $(OBJ)/.demo-i386-cross-wine.txt)"',
      '\t@printf "MINGW=%s\\n" "$$(grep \'^c_link_args\' $(OBJ)/.mingw-i386-cross-wine.txt)"',
    ].join('\n') + '\n',
  );

  const values = runMake(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'});
  assert.equal(
    values.WINE,
    `c_link_args = ['-L${path.join(fixture, 'wine-i386', 'lib', 'wine', 'i386-unix')}', '-m32', '-mwindows']`,
    'the winelib cross overlay must prepend the target-arch wine unix archive dir and keep every cross flag',
  );
  assert.equal(values.MINGW, "c_link_args = ['-mno-cygwin']", 'the MinGW PE cross file must stay unchanged');
});

function crossFixtureMakefile(fixture, crossFile, postSourceLines) {
  return [
    `SRC := ${repository}`,
    `FIXTURE := ${fixture}`,
    `OBJ := ${path.join(fixture, 'obj')}`,
    'HOST_ARCH := x86_64',
    'ARCHS := i386-unix i386-windows',
    'J := 1',
    'include $(SRC)/make/utility.mk',
    'include $(SRC)/make/rules-common.mk',
    'include $(SRC)/make/rules-meson-wine.mk',
    `WINE_i386_DST := ${path.join(fixture, 'wine-i386')}`,
    `WINE_i386_BINDIR := ${path.join(fixture, 'wine-i386', 'bin')}`,
    `DEMO_SRC := ${path.join(fixture, 'src')}`,
    'DEMO_HOST_DEPENDS := wine',
    `DEMO_i386_MESON_ARGS = --cross-file=${crossFile} --libdir=lib/demo`,
    '$(eval $(call rules-meson-wine,demo,i386,windows))',
    '$(OBJ)/.demo-post-source:',
    '\t@mkdir -p $(OBJ)',
    ...postSourceLines,
    'check-cross: $(OBJ)/.demo-i386-cross-wine.txt',
    '\t@printf "WINE=%s\\n" "$$(grep \'^c_link_args\' $(OBJ)/.demo-i386-cross-wine.txt)"',
  ].join('\n') + '\n';
}

test('the generated cross overlay is rebuilt when the checked-in cross file changes', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meson-wine-regen-'));
  t.after(() => fs.rmSync(fixture, {recursive: true, force: true}));
  const wineCross = path.join(fixture, 'cross-wine.txt');
  const generated = path.join(fixture, 'obj', '.demo-i386-cross-wine.txt');
  const makefile = path.join(fixture, 'regen.mk');
  // The real source sync creates the cross file during post-source; reproduce
  // that here so the order-only post-source dependency is exercised too.
  fs.writeFileSync(
    makefile,
    crossFixtureMakefile(fixture, wineCross, [
      `\t@printf '%s\\n' "[binaries]" "c = 'winegcc'" "" "[built-in options]" "c_link_args = ['-m32', '-mwindows']" > ${wineCross}`,
      '\t@touch $@',
    ]),
  );
  assert.equal(fs.existsSync(wineCross), false);
  const first = runMake(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'});
  assert.match(first.WINE, /'-m32'/);
  assert.match(first.WINE, /'-mwindows'/);

  // Editing the checked-in cross file must regenerate the overlay.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m64', '-mwindows']\n");
  fs.utimesSync(generated, new Date(1000), new Date(1000));
  const second = runMake(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'});
  assert.match(second.WINE, /'-m64'/);
  assert.doesNotMatch(second.WINE, /'-m32'/);
});

test('unsupported winegcc c_link_args syntax fails closed before publishing', (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-meson-wine-badcross-'));
  t.after(() => fs.rmSync(fixture, {recursive: true, force: true}));
  const wineCross = path.join(fixture, 'cross-wine.txt');
  const generated = path.join(fixture, 'obj', '.demo-i386-cross-wine.txt');
  const makefile = path.join(fixture, 'bad.mk');
  fs.writeFileSync(makefile, crossFixtureMakefile(fixture, wineCross, ['\t@touch $@']));

  // Missing c_link_args.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);

  // Present but not an array.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = foo\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);

  // Unterminated array: the independent tester's failing control.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m32'\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);

  // Unterminated quoted token inside the array.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m32]\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);

  // Trailing comma is outside the supported pinned grammar.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m32', ]\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);

  // More than one assignment.
  fs.writeFileSync(wineCross, "[binaries]\nc = 'winegcc'\n\n[built-in options]\nc_link_args = ['-m32']\nc_link_args = ['-m64']\n");
  runMakeFailure(fixture, makefile, 'check-cross', {PATH: '/usr/bin:/bin'}, /unsupported winegcc c_link_args syntax/);
  assert.equal(fs.existsSync(generated), false);
});
