// SPDX-License-Identifier: MIT
import fs from 'node:fs';
import path from 'node:path';
// Auditable build-configuration parity contract for the pinned official
// Proton-CachyOS source. Nothing here runs a build. The parsers read the
// pinned upstream Makefile.in and configure.sh, and the validators reject a
// local tree that silently drops a feature, an optional namespace, a module
// build fragment or a configure switch.
//
// Each entry mirrors one WITHOUT_* guard in the pinned official Makefile.in:
//   upstreamDefault: null  no assignment, so the feature is built by default
//                          and can be disabled through configureOption.
//   upstreamDefault: '1'   the pinned source defaults the feature off while
//                          keeping an explicit opt-in. The declaration must
//                          keep the upstream '?=' operator, otherwise an
//                          explicit opt-in is silently overridden.
//   paths                  submodule prefixes that provide the feature.
//   buildFiles             build fragments that the enabled guard must include.
export const CACHYOS_FAMILY = 'nexus-cachyos';

export const CACHYOS_FEATURE_MATRIX = Object.freeze([
  Object.freeze({
    namespace: 'steamrtdeps',
    variable: 'WITHOUT_STEAMRT_DEPENDS',
    upstreamDefault: null,
    configureOption: '--without-steamrt-depends',
    optIn: null,
    paths: Object.freeze(['steamrtdeps/']),
    buildFiles: Object.freeze([
      'include $(SRC)/steamrtdeps/build-libwebp.mk',
      'include $(SRC)/steamrtdeps/build-libxml2.mk',
      'include $(SRC)/steamrtdeps/build-libxkbcommon.mk',
      'include $(SRC)/steamrtdeps/build-wayland-protocols.mk',
      'include $(SRC)/steamrtdeps/build-libpcap.mk',
      'include $(SRC)/steamrtdeps/build-xz.mk',
      'include $(SRC)/steamrtdeps/build-speexdsp.mk',
      'include $(SRC)/steamrtdeps/build-speex.mk',
      'include $(SRC)/steamrtdeps/build-flac.mk',
    ]),
  }),
  Object.freeze({
    namespace: 'tts',
    variable: 'WITHOUT_TTS',
    upstreamDefault: null,
    configureOption: '--without-tts',
    optIn: null,
    paths: Object.freeze(['openfst', 'kaldi', 'piper', 'vosk-api']),
    buildFiles: Object.freeze([]),
  }),
  Object.freeze({
    namespace: 'extras',
    variable: 'WITHOUT_EXTRAS',
    upstreamDefault: null,
    configureOption: '--without-extras',
    optIn: null,
    paths: Object.freeze(['extras/']),
    buildFiles: Object.freeze([
      'include $(SRC)/extras/build-dxvk-sarek.mk',
      'include $(SRC)/extras/build-d7vk.mk',
      'include $(SRC)/extras/build-dxvk-low-latency.mk',
      'include $(SRC)/extras/build-vkd3d-low-latency.mk',
      'include $(SRC)/extras/build-discord-rpc-bridge.mk',
    ]),
  }),
  Object.freeze({
    namespace: 'steam-audio',
    variable: 'WITHOUT_STEAM_AUDIO',
    upstreamDefault: '1',
    configureOption: null,
    // The pinned official source has no configure switch. Upstream keeps the
    // opt-in through the make variable only, so Nexus keeps that exact ability.
    optIn: 'make WITHOUT_STEAM_AUDIO=0',
    paths: Object.freeze(['steam-audio/']),
    buildFiles: Object.freeze(['include $(SRC)/steam-audio/build-steam-audio.mk']),
  }),
  Object.freeze({
    namespace: 'nvidia-libs',
    variable: 'WITHOUT_NVIDIA_LIBS',
    upstreamDefault: null,
    configureOption: '--without-nvidia-libs',
    optIn: null,
    paths: Object.freeze(['nvidia-libs/']),
    buildFiles: Object.freeze([
      'include $(SRC)/nvidia-libs/build-nvcuda.mk',
      'include $(SRC)/nvidia-libs/build-nvenc.mk',
      'include $(SRC)/nvidia-libs/build-wine-nvml.mk',
      'include $(SRC)/nvidia-libs/build-wine-nvoptix.mk',
    ]),
  }),
  Object.freeze({
    namespace: 'zluda-libs',
    variable: 'WITHOUT_ZLUDA_LIBS',
    upstreamDefault: '1',
    configureOption: '--without-zluda-libs',
    // --without-zluda-libs=0 writes WITHOUT_ZLUDA_LIBS := 0, which enables it.
    optIn: '--without-zluda-libs=0',
    paths: Object.freeze(['zluda-libs/']),
    buildFiles: Object.freeze([
      'include $(SRC)/zluda-libs/build-rocm-systems.mk',
      'include $(SRC)/zluda-libs/build-hipwine.mk',
      'include $(SRC)/zluda-libs/bundle-zluda.mk',
    ]),
  }),
  Object.freeze({
    namespace: 'vklayers',
    variable: 'WITHOUT_VKLAYERS',
    upstreamDefault: null,
    configureOption: '--without-vklayers',
    optIn: null,
    paths: Object.freeze(['vklayers/']),
    buildFiles: Object.freeze([
      'include $(SRC)/vklayers/build-dxvk-nvapi-vkreflex-layer.mk',
      'include $(SRC)/vklayers/build-pyroveil.mk',
      'include $(SRC)/vklayers/build-low_latency_layer.mk',
      'include $(SRC)/vklayers/build-vkbasalt.mk',
    ]),
  }),
]);

// Only default-disabled namespaces can be opted in, which keeps an accidental
// typo from silently changing the fetch plan.
export function optInFeature(namespace) {
  const entry = CACHYOS_FEATURE_MATRIX.find(item => item.namespace === namespace);
  if (!entry || entry.upstreamDefault !== '1' || !entry.optIn) throw Error('Unreviewed optional source feature: ' + String(namespace));
  return entry;
}

export function defaultDisabledFeatures() {
  return CACHYOS_FEATURE_MATRIX.filter(entry => entry.upstreamDefault === '1');
}

export function defaultDisabledNamespacePrefixes() {
  return defaultDisabledFeatures().flatMap(entry => entry.paths);
}

// Top-level Makefile.in assignments only. Recipe lines are tab indented and
// never match, so an echoed value cannot be mistaken for a build default.
export function parseMakefileAssignments(text) {
  if (typeof text !== 'string') throw Error('Missing Makefile text');
  const result = new Map();
  for (const line of text.split('\n')) {
    const match = /^([A-Z][A-Z0-9_]*)[ \t]*(\?=|:=|\+=|=)[ \t]*(.*?)[ \t]*$/.exec(line);
    if (!match || !/^(?:WITHOUT|ENABLE)_[A-Z0-9_]+$/.test(match[1])) continue;
    if (result.has(match[1])) throw Error('Duplicate build feature assignment: ' + match[1]);
    result.set(match[1], { operator: match[2], value: match[3] });
  }
  return result;
}

// Returns every guard variable and the build fragments inside its block(s).
// A variable can have more than one guarded block; WITHOUT_TTS has two.
export function parseGuardBlocks(text) {
  if (typeof text !== 'string') throw Error('Missing Makefile text');
  const variables = [], includes = new Map();
  let current = null, depth = 0;
  const close = () => {
    if (!current) return;
    const merged = includes.get(current.variable) ?? [];
    for (const file of current.includes) if (!merged.includes(file)) merged.push(file);
    includes.set(current.variable, merged);
    current = null;
  };
  for (const line of text.split('\n')) {
    if (!current) {
      const guard = /^ifneq \(\$\((WITHOUT_[A-Z0-9_]+)\),1\)$/.exec(line);
      if (guard) {
        current = { variable: guard[1], includes: [] };
        depth = 0;
        if (!variables.includes(guard[1])) variables.push(guard[1]);
      }
      continue;
    }
    if (/^(?:ifeq|ifneq|ifdef|ifndef)\b/.test(line)) depth++;
    else if (/^endif\b/.test(line)) {
      if (depth > 0) depth--;
      else close();
    } else if (/^include \$\(SRC\)\//.test(line)) current.includes.push(line);
  }
  if (current) throw Error('Unterminated build feature guard: ' + current.variable);
  return { variables, includes };
}

export function parseConfigureOptions(text) {
  if (typeof text !== 'string') throw Error('Missing configure text');
  return new Set([...text.matchAll(/\[\[ \$arg = (--[a-z0-9-]+) \]\]/g)].map(match => match[1]));
}

export function parseConfigureEmittedVariables(text) {
  if (typeof text !== 'string') throw Error('Missing configure text');
  return new Set([...text.matchAll(/echo "([A-Z][A-Z0-9_]+) :=/g)].map(match => match[1]));
}

// Verifies one tree against the reviewed contract. It fails closed for any
// unreviewed WITHOUT_* default or guard, so adding a new feature opt-out with
// a default requires an explicit manifest update and review.
export function verifyFeatureMatrix({ makefile, configure, matrix = CACHYOS_FEATURE_MATRIX } = {}) {
  const assignments = parseMakefileAssignments(makefile);
  const guards = parseGuardBlocks(makefile);
  const options = parseConfigureOptions(configure);
  const emitted = parseConfigureEmittedVariables(configure);
  const reviewed = new Set();
  for (const entry of matrix) {
    if (reviewed.has(entry.variable)) throw Error('Duplicate optional feature declaration: ' + entry.variable);
    reviewed.add(entry.variable);
    if (!guards.variables.includes(entry.variable)) throw Error('Missing upstream build feature guard: ' + entry.variable);
    const assignment = assignments.get(entry.variable);
    if (entry.upstreamDefault === null) {
      if (assignment) throw Error(`${entry.variable} must keep the pinned upstream default and build ${entry.namespace} by default`);
    } else {
      if (!assignment) throw Error(`${entry.variable} must declare the pinned upstream default ${entry.upstreamDefault}`);
      if (assignment.value !== entry.upstreamDefault) throw Error(`${entry.variable} default differs from the pinned upstream value ${entry.upstreamDefault}`);
      if (assignment.operator !== '?=') throw Error(`${entry.variable} must keep the upstream ?= operator so an explicit opt-in still works`);
    }
    const guardIncludes = guards.includes.get(entry.variable) ?? [];
    for (const file of entry.buildFiles) if (!guardIncludes.includes(file)) throw Error(`Missing build fragment for ${entry.namespace}: ${file}`);
    if (entry.configureOption) {
      if (!options.has(entry.configureOption)) throw Error('Missing upstream configure option: ' + entry.configureOption);
      if (!emitted.has(entry.variable)) throw Error('Configure no longer writes the upstream feature variable: ' + entry.variable);
    }
  }
  for (const variable of assignments.keys()) if (!reviewed.has(variable)) throw Error('Unreviewed build feature default: ' + variable);
  for (const variable of guards.variables) if (!reviewed.has(variable)) throw Error('Unreviewed build feature guard: ' + variable);
  return { variables: [...reviewed], namespaces: matrix.map(entry => entry.namespace) };
}

const serializedAssignments = map => JSON.stringify([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));

// Binds the local tree to the exact pinned official source objects. Additions
// that Nexus documents are allowed; a removed feature default, guard, build
// fragment, configure option or configure output is not.
export function verifyPinnedUpstreamParity({ upstreamMakefile, upstreamConfigure, currentMakefile, currentConfigure, matrix = CACHYOS_FEATURE_MATRIX } = {}) {
  verifyFeatureMatrix({ makefile: upstreamMakefile, configure: upstreamConfigure, matrix });
  verifyFeatureMatrix({ makefile: currentMakefile, configure: currentConfigure, matrix });
  const upstreamAssignments = parseMakefileAssignments(upstreamMakefile);
  const currentAssignments = parseMakefileAssignments(currentMakefile);
  if (serializedAssignments(upstreamAssignments) !== serializedAssignments(currentAssignments)) throw Error('Build feature defaults differ from the pinned official source');
  const upstreamGuards = parseGuardBlocks(upstreamMakefile);
  const currentGuards = parseGuardBlocks(currentMakefile);
  const sortUnique = values => [...new Set(values)].sort();
  const upstreamVariables = sortUnique(upstreamGuards.variables);
  if (JSON.stringify(upstreamVariables) !== JSON.stringify(sortUnique(currentGuards.variables))) throw Error('Build feature guards differ from the pinned official source');
  for (const variable of upstreamVariables) {
    const expected = upstreamGuards.includes.get(variable) ?? [];
    const actual = currentGuards.includes.get(variable) ?? [];
    for (const file of expected) if (!actual.includes(file)) throw Error('Build fragment missing relative to the pinned official source: ' + file);
  }
  const upstreamOptions = parseConfigureOptions(upstreamConfigure);
  const currentOptions = parseConfigureOptions(currentConfigure);
  for (const option of upstreamOptions) if (!currentOptions.has(option)) throw Error('Configure option missing relative to the pinned official source: ' + option);
  const upstreamEmitted = parseConfigureEmittedVariables(upstreamConfigure);
  const currentEmitted = parseConfigureEmittedVariables(currentConfigure);
  for (const variable of upstreamEmitted) if (!currentEmitted.has(variable)) throw Error('Configure variable missing relative to the pinned official source: ' + variable);
  return {
    variables: upstreamVariables,
    defaultAssignments: Object.fromEntries([...currentAssignments.entries()].sort(([left], [right]) => left.localeCompare(right))),
    configureOptions: [...currentOptions].sort(),
  };
}

// Fail-closed local check used before a fetch or build plan is computed. It
// needs no Git history, so a prepared tree cannot plan around changed defaults.
export function verifyLocalFeatureMatrix(root, matrix = CACHYOS_FEATURE_MATRIX) {
  if (typeof root !== 'string' || !root) throw Error('Missing build configuration root');
  return verifyFeatureMatrix({
    makefile: fs.readFileSync(path.join(root, 'Makefile.in'), 'utf8'),
    configure: fs.readFileSync(path.join(root, 'configure.sh'), 'utf8'),
    matrix,
  });
}
