#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
#
# Prepare the pinned NVIDIA NVML header for the wine-nvml generator.
#
# The upstream generator (nvidia-libs/wine-nvml/src/make_nvml) downloads nvml.h
# from a mutable upstream tag when the versioned header is missing and verifies
# no checksum. nexus/nvml-header.lock.json pins the parent module commit, the
# upstream version, an immutable commit URL, the SHA-256 and the byte size.
#
# Two modes keep the checks honest in the actual build layout:
#
#   host-prepare
#     Runs on the build host, before the SDK container starts. It reads the real
#     Git metadata (parent Git link and module checkout HEAD), requires the
#     working generator inputs to be byte-identical to the pinned module commit,
#     hashes the audited lock and those inputs, prepares the verified canonical
#     header, and writes an exclusive proof file inside the SDK build directory.
#
#   prepare
#     Runs inside the SDK container, which mounts only the source tree and the
#     object directory. It requires the proof, re-validates it against the
#     current source path, the current lock bytes, the module generator inputs
#     and the canonical header, then copies the header into the build source
#     directories. It never reads Git metadata and never downloads, so a linked
#     Git worktree whose metadata lives outside the mounted tree is still built
#     from a host verified pin, and a direct container build without the proof
#     fails with the exact host preflight command instead of pretending the pin
#     was checked.
#
# Path safety: every path is absolute and lexically clean, and every existing
# ancestor must be a real directory. Symlinks are refused so reads and writes
# cannot be redirected outside the prepared tree. The only path that may be a
# symlink is --source itself, and only through an explicit resolution that is
# reported and then used for every derived path.
#
# The recipes run inside the pinned Proton SDK container, which provides bash,
# coreutils and python3 (Makefile.in already runs python3 from container
# recipes). The host preflight uses git, curl, coreutils and python3. No Node or
# new SDK dependency is added.

set -euo pipefail

readonly PROGRAM=${0##*/}

die() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

info() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
}

usage() {
  cat >&2 <<'EOF'
Usage:
  prepare-nvml-header.sh host-prepare --source REPO --proof FILE
  prepare-nvml-header.sh prepare --source REPO --version VERSION --proof FILE [--dest DIR]...
  prepare-nvml-header.sh version --source REPO --version VERSION --proof FILE

host-prepare verifies the real parent Git link and module checkout HEAD of the
pinned wine-nvml module, hashes the audited lock and the module generator
inputs, prepares the verified header REPO/<module>/src/nvml_VERSION.h, and
writes an exclusive proof at FILE inside the SDK build directory.

prepare requires that proof and re-validates it against the current source path,
lock bytes, generator inputs and header before copying the header into every
--dest directory. It never downloads and never reads Git metadata.

version runs the same proof validation and prints the verified module identity
as one deterministic line for the packaged version metadata. It never reads Git
metadata.
EOF
}

case "${1:-}" in
  host-prepare | prepare | version)
    mode=$1
    shift
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage
    die "unknown mode: ${1:-none}"
    ;;
esac

source_argument=""
version=""
proof=""
dests=()

while (($#)); do
  case "$1" in
    --source)
      (($# >= 2)) || die "missing value for --source"
      source_argument=$2
      shift 2
      ;;
    --version)
      (($# >= 2)) || die "missing value for --version"
      version=$2
      shift 2
      ;;
    --proof)
      (($# >= 2)) || die "missing value for --proof"
      proof=$2
      shift 2
      ;;
    --dest)
      (($# >= 2)) || die "missing value for --dest"
      dests+=("$2")
      shift 2
      ;;
    *)
      die "unsupported argument: $1"
      ;;
  esac
done

[[ -n $source_argument ]] || die "--source is required"
[[ -n $proof ]] || die "--proof is required"
if [[ $mode == prepare || $mode == version ]]; then
  [[ -n $version ]] || die "--version is required"
  [[ $version =~ ^[0-9]+(\.[0-9]+)+$ ]] || die "unsupported version: $version"
else
  [[ -z $version ]] || die "--version is not accepted by host-prepare; the version comes from the audited lock"
fi
if [[ $mode == host-prepare ]]; then
  ((${#dests[@]} == 0)) || die "--dest is not accepted by host-prepare"
fi
if [[ $mode == version ]]; then
  ((${#dests[@]} == 0)) || die "--dest is not accepted by version"
fi

# Reject empty, "." and ".." components because they make the symlink checks
# below ambiguous.
require_clean_absolute() {
  local path=$1 label=$2 remainder component
  local -a components
  [[ $path == /* ]] || die "$label must be an absolute path: $path"
  [[ $path != / ]] || die "$label must not be the filesystem root"
  remainder=${path#/}
  IFS='/' read -r -a components <<< "$remainder"
  for component in "${components[@]}"; do
    if [[ -z $component ]]; then
      die "$label contains an empty path component: $path"
    fi
    case "$component" in
      . | ..)
        die "$label contains a relative path component: $path"
        ;;
    esac
  done
}

# Every existing component of a directory path must be a real directory, and the
# final component must exist.
require_real_directory() {
  local path=$1 label=$2 remainder component prefix="" index count
  local -a components
  require_clean_absolute "$path" "$label"
  remainder=${path#/}
  IFS='/' read -r -a components <<< "$remainder"
  count=${#components[@]}
  for ((index = 0; index < count; index++)); do
    component=${components[index]}
    prefix+="/$component"
    if [[ -L $prefix ]]; then
      die "$label traverses a symlink: $prefix"
    fi
    if [[ -e $prefix ]]; then
      if [[ ! -d $prefix ]]; then
        die "$label traverses a non-directory: $prefix"
      fi
    elif ((index == count - 1)); then
      die "$label is missing: $path"
    fi
  done
}

# Every existing ancestor of a file path must be a real directory. The file may
# be absent, but when it exists it must be a regular file and never a symlink.
require_real_file_path() {
  local path=$1 label=$2 remainder parent component prefix="" index count
  local -a components
  require_clean_absolute "$path" "$label"
  remainder=${path#/}
  if [[ $remainder == */* ]]; then
    parent=${remainder%/*}
    IFS='/' read -r -a components <<< "$parent"
    count=${#components[@]}
    for ((index = 0; index < count; index++)); do
      component=${components[index]}
      prefix+="/$component"
      if [[ -L $prefix ]]; then
        die "$label traverses a symlink: $prefix"
      fi
      if [[ -e $prefix ]]; then
        if [[ ! -d $prefix ]]; then
          die "$label traverses a non-directory: $prefix"
        fi
      else
        die "$label parent is missing: $prefix"
      fi
    done
  fi
  if [[ -L $path ]]; then
    die "$label is a symlink: $path"
  fi
  if [[ -e $path && ! -f $path ]]; then
    die "$label is not a regular file: $path"
  fi
}

require_clean_absolute "$source_argument" "--source"
resolved_source=$(realpath -e -- "$source_argument") ||
  die "--source does not resolve to an existing path: $source_argument"
require_clean_absolute "$resolved_source" "--source"
require_real_directory "$resolved_source" "--source"
if [[ $resolved_source != "$source_argument" ]]; then
  info "explicitly resolved --source $source_argument to $resolved_source"
fi

require_clean_absolute "$proof" "--proof"
require_real_file_path "$proof" "--proof"

readonly lock_file="$resolved_source/nexus/nvml-header.lock.json"
require_real_file_path "$lock_file" "the audited lock"
[[ -e $lock_file ]] || die "missing audited lock: $lock_file"

# Read and validate the audited lock. Pins come only from this file. The parser
# fails closed, so a malformed or partially rewritten lock can never downgrade
# verification.
lock_values=$(python3 - "$lock_file" <<'PY'
import json
import re
import sys

path = sys.argv[1]

try:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
except OSError as error:
    raise SystemExit("cannot read lock file: %s" % error)
except ValueError as error:
    raise SystemExit("lock file is not valid JSON: %s" % error)

if not isinstance(data, dict):
    raise SystemExit("lock file must contain a JSON object")
if data.get("schema") != 1:
    raise SystemExit("unsupported lock schema")
if data.get("component") != "wine-nvml":
    raise SystemExit("lock file is not for wine-nvml")


def text(key, pattern):
    value = data.get(key)
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        raise SystemExit("invalid lock field: %s" % key)
    return value


module = text("module", r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+")
module_commit = text("moduleCommit", r"[0-9a-f]{40}")
name = text("name", r"[A-Za-z0-9._-]+")
version = text("version", r"[0-9]+(?:\.[0-9]+)+")
tag = text("declaredTag", r"[0-9]+(?:\.[0-9]+)+")
repository = text("repository", r"https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
commit = text("commit", r"[0-9a-f]{40}")
digest = text("sha256", r"[0-9a-f]{64}")
url = text("url", r"https://[!-~]+")

if any(part in (".", "..") for part in module.split("/")):
    raise SystemExit("invalid lock field: module")
if tag != version:
    raise SystemExit("declared tag differs from the pinned version")
raw_base = "https://raw.githubusercontent.com/" + repository[len("https://github.com/"):]
if url != "%s/%s/src/%s" % (raw_base, commit, name):
    raise SystemExit("url is not the immutable commit URL for the pinned header")

byte_count = data.get("bytes")
if isinstance(byte_count, bool) or not isinstance(byte_count, int) or not 0 < byte_count <= 16 * 1024 * 1024:
    raise SystemExit("invalid lock field: bytes")

fields = (
    ("module", module),
    ("moduleCommit", module_commit),
    ("name", name),
    ("version", version),
    ("repository", repository),
    ("commit", commit),
    ("url", url),
    ("sha256", digest),
    ("bytes", str(byte_count)),
)
sys.stdout.write("".join("%s\t%s\n" % item for item in fields))
PY
) || die "cannot read the audited lock: $lock_file"

declare -A pinned=()
while IFS=$'\t' read -r key value; do
  [[ -n $key ]] || continue
  pinned[$key]=$value
done <<< "$lock_values"

for key in module moduleCommit name version repository commit url sha256 bytes; do
  [[ -n ${pinned[$key]:-} ]] || die "lock file is missing $key"
done
[[ ${pinned[name]} == "nvml.h" ]] || die "unexpected pinned header name: ${pinned[name]}"
[[ ${pinned[bytes]} =~ ^[0-9]+$ ]] || die "invalid pinned size: ${pinned[bytes]}"

if [[ $mode != host-prepare && ${pinned[version]} != "$version" ]]; then
  die "requested version $version differs from the pinned ${pinned[version]}"
fi

readonly pinned_version=${pinned[version]}
readonly module_path=${pinned[module]}
readonly module_commit=${pinned[moduleCommit]}
readonly pinned_url=${pinned[url]}
readonly pinned_sha=${pinned[sha256]}
readonly pinned_bytes=${pinned[bytes]}
readonly module_root="$resolved_source/$module_path"
readonly src_dir="$module_root/src"
readonly header_name="nvml_${pinned_version}.h"
readonly canonical="$src_dir/$header_name"

require_real_directory "$module_root" "the pinned module directory"
require_real_directory "$src_dir" "the pinned generator directory"

lock_sha=$(sha256sum -- "$lock_file") || die "cannot hash the audited lock: $lock_file"
lock_sha=${lock_sha%% *}

file_sha256() {
  local output
  output=$(sha256sum -- "$1") || return 1
  printf '%s\n' "${output%% *}"
}

file_size() {
  stat -c %s -- "$1"
}

# Returns 0 when the file already holds the pinned header, 1 when it is absent,
# and fails for anything that must not be replaced or followed.
verify_header() {
  local file=$1 actual_size actual_sha
  if [[ -L $file ]]; then
    die "refusing to use a symlink: $file"
  fi
  if [[ ! -e $file ]]; then
    return 1
  fi
  [[ -f $file ]] || die "refusing to use a non-regular file: $file"
  actual_size=$(file_size "$file") || die "cannot read the size of $file"
  if [[ $actual_size != "$pinned_bytes" ]]; then
    die "pinned size mismatch for $file (expected $pinned_bytes, found $actual_size)"
  fi
  actual_sha=$(file_sha256 "$file") || die "cannot hash $file"
  if [[ $actual_sha != "$pinned_sha" ]]; then
    die "pinned SHA-256 mismatch for $file (refusing to overwrite)"
  fi
  return 0
}

host_preflight_command() {
  printf '%q host-prepare --source %q --proof %q' \
    "$source_argument/nexus/prepare-nvml-header.sh" "$source_argument" "$proof"
}

if [[ $mode == prepare || $mode == version ]]; then
  [[ -f $proof ]] || die "missing host NVML proof: $proof
Run the host preflight before the SDK build:
  $(host_preflight_command)"
  if ! verify_header "$canonical"; then
    die "missing verified header: $canonical
Run the host preflight before the SDK build:
  $(host_preflight_command)"
  fi
  verified_identity=$(python3 - "$proof" "$source_argument" "$resolved_source" "$lock_file" "$lock_sha" \
    "$module_path" "$module_commit" "$pinned_version" "$pinned_sha" "$pinned_bytes" \
    "$module_root" "$canonical" <<'PY'
import hashlib
import json
import os
import re
import stat
import sys

(proof_path, source_argument, resolved_source, lock_path, lock_sha,
 module_path, module_commit, version, header_sha, header_bytes,
 module_root, canonical) = sys.argv[1:]

GENERATOR_INPUTS = ("src/make_nvml", "src/meson.build", "meson.build")


def fail(message):
    raise SystemExit(message)


def digest(path):
    try:
        with open(path, "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()
    except OSError as error:
        fail("cannot read %s: %s" % (path, error))


def regular_file(path, label):
    try:
        info = os.lstat(path)
    except OSError as error:
        fail("%s is missing: %s" % (label, error))
    if stat.S_ISLNK(info.st_mode):
        fail("%s is a symlink: %s" % (label, path))
    if not stat.S_ISREG(info.st_mode):
        fail("%s is not a regular file: %s" % (label, path))
    return info.st_size


def text(value, pattern, label):
    if not isinstance(value, str) or not re.fullmatch(pattern, value):
        fail("proof field %s is invalid" % label)
    return value


try:
    with open(proof_path, "r", encoding="utf-8") as handle:
        proof = json.load(handle)
except OSError as error:
    fail("cannot read the proof: %s" % error)
except ValueError as error:
    fail("the proof is not valid JSON: %s" % error)
if not isinstance(proof, dict):
    fail("the proof must contain a JSON object")
if proof.get("schema") != 1:
    fail("unsupported proof schema")
if proof.get("component") != "wine-nvml":
    fail("the proof is not for wine-nvml")

if text(proof.get("sourcePath"), r"/.+", "sourcePath") != source_argument:
    fail("the proof was made for another source path")
text(proof.get("sourceHead"), r"[0-9a-f]{40}", "sourceHead")
proof_root = text(proof.get("sourceRoot"), r"/.+", "sourceRoot")
if proof_root != resolved_source:
    fail("the proof was made for another resolved source root")

if text(proof.get("module"), r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+", "module") != module_path:
    fail("the proof was made for another module")
if text(proof.get("moduleCommit"), r"[0-9a-f]{40}", "moduleCommit") != module_commit:
    fail("the proof pins another module commit")
if text(proof.get("moduleHead"), r"[0-9a-f]{40}", "moduleHead") != module_commit:
    fail("the proof records another module checkout HEAD")
if text(proof.get("version"), r"[0-9]+(?:\.[0-9]+)+", "version") != version:
    fail("the proof pins another version")
if text(proof.get("lockSha256"), r"[0-9a-f]{64}", "lockSha256") != lock_sha or digest(lock_path) != lock_sha:
    fail("the audited lock changed after the host preflight")

header = proof.get("header")
if not isinstance(header, dict):
    fail("the proof has no header identity")
expected_header_path = "%s/src/nvml_%s.h" % (module_path, version)
if header.get("path") != expected_header_path:
    fail("the proof pins another header path")
if header.get("sha256") != header_sha or str(header.get("bytes")) != header_bytes:
    fail("the proof pins another header identity")
header_size = regular_file(canonical, "the verified header")
if str(header_size) != header_bytes or digest(canonical) != header_sha:
    fail("the canonical header does not match the audited pin")

entries = proof.get("generator")
if not isinstance(entries, list) or len(entries) != len(GENERATOR_INPUTS):
    fail("the proof does not bind the module generator inputs")
found = {}
for entry in entries:
    if not isinstance(entry, dict):
        fail("the proof has a malformed generator entry")
    path = entry.get("path")
    if path not in GENERATOR_INPUTS or path in found:
        fail("the proof has an unexpected generator input: %s" % path)
    sha = text(entry.get("sha256"), r"[0-9a-f]{64}", "generator sha256")
    size = entry.get("bytes")
    if isinstance(size, bool) or not isinstance(size, int) or size < 0:
        fail("the proof has an invalid generator size")
    found[path] = (sha, size)
for path in GENERATOR_INPUTS:
    absolute = os.path.join(module_root, path)
    actual_size = regular_file(absolute, "the module input " + path)
    sha, size = found[path]
    if actual_size != size or digest(absolute) != sha:
        fail("the module input %s changed after the host preflight" % path)

print(" %s %s" % (module_commit, module_path))
PY
  ) || die "host NVML proof rejected; run the host preflight again:
  $(host_preflight_command)"
  if [[ $mode == version ]]; then
    printf '%s\n' "$verified_identity"
  fi
fi

require_git_host_source() {
  command -v git > /dev/null 2>&1 ||
    die "git is required for the host preflight but was not found in PATH; run host-prepare on the build host"
}

if [[ $mode == host-prepare ]]; then
  require_git_host_source

  source_head=$(git -C "$resolved_source" rev-parse --verify 'HEAD^{commit}' 2>/dev/null) ||
    die "cannot read the parent Git HEAD in $resolved_source"
  [[ $source_head =~ ^[0-9a-f]{40}$ ]] || die "unexpected parent Git HEAD: $source_head"

  expected_gitlink=$(printf '160000 commit %s\t%s' "$module_commit" "$module_path")
  actual_gitlink=$(git -C "$resolved_source" ls-tree HEAD -- "$module_path" 2>/dev/null) ||
    die "cannot read the parent Git tree in $resolved_source"
  if [[ $actual_gitlink != "$expected_gitlink" ]]; then
    die "parent Git link mismatch for $module_path (pinned $module_commit, found '${actual_gitlink:-none}')"
  fi

  module_toplevel=$(git -C "$module_root" rev-parse --show-toplevel 2>/dev/null) ||
    die "cannot read the module checkout in $module_root"
  module_toplevel=$(realpath -e -- "$module_toplevel") ||
    die "cannot resolve the module checkout root: $module_toplevel"
  if [[ $module_toplevel != "$module_root" ]]; then
    die "module checkout root mismatch in $module_root (found '$module_toplevel')"
  fi

  module_head=$(git -C "$module_root" rev-parse --verify 'HEAD^{commit}' 2>/dev/null) ||
    die "cannot read the module checkout HEAD in $module_root"
  if [[ $module_head != "$module_commit" ]]; then
    die "module checkout HEAD mismatch in $module_root (pinned $module_commit, found '$module_head')"
  fi

  for relative in src/make_nvml src/meson.build meson.build; do
    require_real_file_path "$module_root/$relative" "the module input $relative"
    [[ -f $module_root/$relative ]] || die "missing module input: $module_root/$relative"
    pinned_bytes_sha=$(git -C "$module_root" cat-file blob "${module_commit}:${relative}" 2>/dev/null | sha256sum) ||
      die "the pinned module commit does not contain $relative"
    pinned_bytes_sha=${pinned_bytes_sha%% *}
    worktree_sha=$(file_sha256 "$module_root/$relative") || die "cannot hash the module input $relative"
    if [[ $worktree_sha != "$pinned_bytes_sha" ]]; then
      die "module input $relative does not match the pinned module commit $module_commit (dirty, deleted or type changed)"
    fi
  done
fi

scratch_files=()
lock_dirs=()
scratch=""

cleanup() {
  local item
  for item in "${scratch_files[@]+"${scratch_files[@]}"}"; do
    if [[ -n $item ]]; then
      rm -f -- "$item" || true
    fi
  done
  for item in "${lock_dirs[@]+"${lock_dirs[@]}"}"; do
    rmdir -- "$item" 2>/dev/null || true
  done
}
trap cleanup EXIT

new_scratch() {
  local directory=$1
  scratch=$(mktemp --tmpdir="$directory" ".nvml-header-${pinned_version}.XXXXXXXX") ||
    die "cannot create a temporary file in $directory"
  scratch_files+=("$scratch")
}

# Publish a verified temporary file without replacing whatever appeared at the
# target in the meantime, then require the published bytes to match the pin.
publish() {
  local temporary=$1 target=$2
  mv -n -- "$temporary" "$target" || die "cannot publish $target"
  if ! verify_header "$target"; then
    die "header disappeared while publishing: $target"
  fi
}

acquire_lock() {
  local directory=$1 lock_directory="$1/.nvml-header-${pinned_version}.lock" attempt
  for ((attempt = 0; attempt < 300; attempt++)); do
    if mkdir -- "$lock_directory" 2>/dev/null; then
      lock_dirs+=("$lock_directory")
      return 0
    fi
    sleep 0.2
  done
  die "timed out waiting for $lock_directory (remove it only after confirming that no build is running)"
}

if [[ $mode == host-prepare ]]; then
  if verify_header "$canonical"; then
    info "reusing verified $canonical"
  else
    info "preparing $canonical"
    acquire_lock "$src_dir"
    if verify_header "$canonical"; then
      info "reusing verified $canonical"
    else
      new_scratch "$src_dir"
      info "downloading $pinned_url"
      curl --fail --silent --show-error \
        --location --proto '=https' --proto-redir '=https' \
        --tlsv1.2 --max-time 120 --retry 2 --retry-delay 1 \
        --max-filesize "$pinned_bytes" \
        --output "$scratch" "$pinned_url" ||
        die "download failed: $pinned_url"
      if ! verify_header "$scratch"; then
        die "downloaded header is missing: $scratch"
      fi
      publish "$scratch" "$canonical"
      info "stored verified $canonical"
    fi
  fi
fi

# Validate every destination and every existing target before the first copy, so
# an invalid later destination or a wrong cached header cannot leave a partial
# mutation in an earlier destination. Absent targets are recorded for the copy
# phase; a valid cached target is allowed and skipped.
copy_dests=()
for dest in "${dests[@]+"${dests[@]}"}"; do
  require_real_directory "$dest" "--dest"
  target="$dest/$header_name"
  if [[ $target == "$canonical" ]]; then
    continue
  fi
  if verify_header "$target"; then
    continue
  fi
  copy_dests+=("$dest")
done

for dest in "${copy_dests[@]+"${copy_dests[@]}"}"; do
  target="$dest/$header_name"
  new_scratch "$dest"
  cp -- "$canonical" "$scratch" || die "cannot copy the verified header into $dest"
  if ! verify_header "$scratch"; then
    die "copied header failed verification in $dest"
  fi
  publish "$scratch" "$target"
done

if [[ $mode == host-prepare ]]; then
  proof_content=$(python3 - "$proof" "$source_argument" "$resolved_source" "$lock_file" "$lock_sha" \
    "$source_head" "$module_path" "$module_commit" "$module_head" "$pinned_version" \
    "$pinned_sha" "$pinned_bytes" "$module_root" <<'PY'
import hashlib
import json
import os
import sys

(proof_path, source_path, source_root, lock_path, lock_sha, source_head,
 module_path, module_commit, module_head, version, header_sha, header_bytes,
 module_root) = sys.argv[1:]

GENERATOR_INPUTS = ("src/make_nvml", "src/meson.build", "meson.build")


def fail(message):
    raise SystemExit(message)


def identity(relative):
    path = os.path.join(module_root, relative)
    try:
        with open(path, "rb") as handle:
            payload = handle.read()
    except OSError as error:
        fail("cannot read the module input %s: %s" % (relative, error))
    return {"path": relative, "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}


proof = {
    "schema": 1,
    "component": "wine-nvml",
    "variant": "nexus-cachyos",
    "sourcePath": source_path,
    "sourceRoot": source_root,
    "sourceHead": source_head,
    "module": module_path,
    "moduleCommit": module_commit,
    "moduleHead": module_head,
    "version": version,
    "lockSha256": lock_sha,
    "header": {
        "path": "%s/src/nvml_%s.h" % (module_path, version),
        "sha256": header_sha,
        "bytes": int(header_bytes),
    },
    "generator": [identity(relative) for relative in GENERATOR_INPUTS],
}
sys.stdout.write(json.dumps(proof, indent=2, sort_keys=True) + "\n")
PY
  ) || die "cannot build the host NVML proof"

  if [[ -e $proof || -L $proof ]]; then
    if [[ $(<"$proof") != "$proof_content" ]]; then
      die "an existing host NVML proof differs from this source; remove $proof to regenerate it"
    fi
    info "reused $proof"
  else
    new_scratch "$(dirname -- "$proof")"
    printf '%s\n' "$proof_content" > "$scratch"
    mv -n -- "$scratch" "$proof" || die "cannot publish $proof"
    if [[ $(<"$proof") != "$proof_content" ]]; then
      die "the host NVML proof changed while publishing: $proof"
    fi
    info "wrote $proof"
  fi
fi
