# Nexus Runtime CachyOS build

This is an experimental, independent integration of CachyOS Proton and Wine with
the Nexus C++ XGameRuntime. It is not an official CachyOS, Valve or Xodus
distribution. Performance and compatibility improvements over the existing Nexus
runtime have not been established.

Source dependencies are exact recursive Git submodules. The SDK, supplementary
libraries and the shader patch are pinned in `inputs.lock.json`. Keep the
submodules at their recorded revisions.

Run source checks with Node.js 22 or newer:

```sh
node nexus/check-source.mjs
node --test nexus/*.test.mjs nexus/tests/*.test.mjs nexus/ci/*.test.mjs nexus/runtime-compat/*.test.mjs
```

Source tests require CMake, GNU Make, rsync, GCC and both MinGW architectures.
The complete build additionally requires the pinned Proton SDK and Docker or
rootless Podman. Auxiliary native libraries must target glibc 2.35 or older.

On this branch, the additional module expansion is not ready for building or
distribution: the license and notice inventory for the newly enabled extras,
NVIDIA library and Vulkan layer components is still incomplete. Existing CachyOS
build and validation results do not cover this expanded component set.

From a clean checkout of this WIP branch, initialize the 50 proposed pinned
modules and their recursive dependencies. Main keeps its existing 35-module set;
the 50-module plan and the upstream-enabled CachyOS component set (extras, NVIDIA
libraries and Vulkan layers) belong to this branch only. This branch build passes
no WITHOUT_* opt-outs. steam-audio and ZLUDA stay excluded because the pinned
upstream Makefile disables both by default
(`WITHOUT_STEAM_AUDIO := 1`, `WITHOUT_ZLUDA_LIBS ?= 1`):

```sh
node nexus/ci/initialize-source.mjs --initialize
node nexus/build-auxiliary.mjs --work /absolute/new-auxiliary-directory
node nexus/build-runtime.mjs /absolute/auxiliary-directory /absolute/new-work-directory /absolute/new-output-directory
```

Set `NEXUS_CONTAINER_ENGINE=podman` for rootless Podman and
`NEXUS_BUILD_JOBS=16` to select a bounded worker count. Add `--resume` to the
same build command only when resuming its exact existing SDK configuration.
Work and output directories must be isolated from games and installed runtimes.

Build output is an unvalidated Experimental candidate, not an installation or
release. Native tests and game validation are separate. Keep corresponding
sources and all applicable licenses with any redistributed binaries.

## Retrying CI validation

The x86_64 candidate workflow keeps compilation and native validation in separate
jobs. ARM64 candidates are disabled for this variant. After a validation failure, use **Re-run failed jobs** to reuse
the compiled runtime and fixtures from the same workflow commit. Checkpoint
artifacts are retained for seven days and are unvalidated until all native gates
pass. A different source commit requires a new build.

Auxiliary dependencies are cached by their recipe, input locks, architecture and
runner image. Restored dependencies are verified before use.

The source plan covers conservative Linux x86_64 with both Windows ABIs. ARM64
and wow64 are not enabled. The upstream-enabled CachyOS extras, NVIDIA libraries
and Vulkan layers are part of this branch plan, while steam-audio and ZLUDA remain
disabled by the pinned upstream defaults. A candidate containing the newly
enabled modules has not been built or validated yet. Exact CachyOS, Nexus Wine
and XGameRuntime revisions are recorded in inputs.lock.json.
