// SPDX-License-Identifier: MIT
// Prepared source graph guard for the NVML host preflight.
//
// `git submodule status` can append a trailing description to an entry, for
// example " <sha> nvidia-libs/wine-nvml (v0.4)" or
// " <sha> nvidia-libs/wine-nvml (heads/main)". The module path is therefore the
// second whitespace separated token, parsed with the same anchored pattern the
// build loop uses, never a suffix match on the whole line.
export const NVML_MODULE_PATH = 'nvidia-libs/wine-nvml';
const SUBMODULE_ENTRY = /^ ([a-f0-9]{40}) (\S+)/;

export function nvmlPreflightRequired(submodules) {
  if (!Array.isArray(submodules)) throw Error('Prepared submodule inventory must be a list');
  let required = false;
  for (const entry of submodules) {
    if (typeof entry !== 'string') throw Error('Malformed prepared submodule entry');
    const match = SUBMODULE_ENTRY.exec(entry);
    if (match && match[2] === NVML_MODULE_PATH) required = true;
  }
  return required;
}
