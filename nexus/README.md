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

## Upstream feature payload

The source build plan retains the pinned official feature set: the D7VK,
DXVK-Sarek and low-latency DXVK/VKD3D renderers, the NVIDIA nvcuda, nvenc, NVML
and NVOPTIX modules, the DXVK-NVAPI Reflex, low-latency, vkBasalt and Pyroveil
Vulkan layers, the Discord RPC bridge, and the non-Steam umu helper. Assembly
verifies these outputs and their entry-script selectors after the copy, so a
reduced or stripped payload fails closed. The source-only payload test can be run
with `node --test nexus/runtime-payload-contract.test.mjs` on synthetic
redistributions; passing selector strings are not a full runtime parity proof.

Steam audio and ZLUDA stay disabled by the pinned upstream defaults. OptiScaler,
Streamline, FSR4, DLSS, XeSS and FFX upgrades are installed by the pinned
upstream protonfixes at game launch, not by this source build and not as shipped
payload. MLFG is absent from this pinned source. The required Discord bridge
payload is selected by the pinned `proton`, and the shipped native umu and steam
helpers implement `PROTON_DISCORD_BRIDGE`; actual service behavior is not
validated here. Wayland, Pipewire, HDR, SDL controller input, OpenXR and the
Vulkan layers also need the corresponding host drivers; their presence in the
source build plan is not a claim that they work in a game. Steam-specific
behavior is not proven for non-Steam use.

The primary target is the published CachyOS 11.0 SLR release from 2026-10-20,
whose protonfixes pin matches this source. Newer documentation-only feature
lists are not part of this target. The required payload paths, entry selectors
and Vulkan layer library basenames follow that released payload, and a payload
`version` stamp that names another commit than the prepared pin is rejected.
That comparison is a source and packaging check, not a functional parity or
compatibility claim.

On this branch the expanded module set is part of the build plan and payload
contract. The source notice inventory covers the shared renderer inputs (DXVK,
Intel GDExt, VKD3D, VKD3D-Proton and DXVK-NVAPI with their compiled or linked
submodules) and the CachyOS extras, NVIDIA libraries and Vulkan layers,
including the thirteen pinned NVIDIA OptiX header files. Those headers are
staged with the binary payload under their original notices, the module README
stays in the corresponding source archive, and the NVML header pin is verified
during preparation. A ready inventory means the declared notices match the
pinned bytes. Native or candidate validation and release approval are still
required.

From a clean checkout of this WIP branch, initialize the 50 proposed pinned
modules and their recursive dependencies. Main keeps its existing 35-module set;
the 50-module plan and the upstream-enabled CachyOS component set (extras, NVIDIA
libraries and Vulkan layers) belong to this branch only. This branch build passes
no WITHOUT_* opt-outs. steam-audio and ZLUDA are default-disabled optional
namespaces (`WITHOUT_STEAM_AUDIO ?= 1`, `WITHOUT_ZLUDA_LIBS ?= 1`). They stay out
of the default fetch plan but can be prepared explicitly with
`--enable-optional=steam-audio,zluda-libs`. Preparing those sources does not
enable them in the managed build: the build stays default-disabled unless the
make variable is explicitly overridden, and no feature is claimed enabled by
this source preparation:

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

The source plan covers conservative Linux x86_64 with both Windows ABIs, matching
the upstream recommended conservative profile. ARM64, v3 and wow64 native
profiles are not enabled and are not claimed. The upstream-enabled CachyOS
extras, NVIDIA libraries and Vulkan layers are part of this branch plan, while
steam-audio and ZLUDA remain disabled by the pinned upstream defaults. A
candidate containing the newly enabled modules has not been built or validated
yet. Exact CachyOS, Nexus Wine and XGameRuntime revisions are recorded in
inputs.lock.json.
