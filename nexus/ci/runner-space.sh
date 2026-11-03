#!/usr/bin/env bash
# Hosted-runner preparation only. Never remove source, caches, Node or Docker layers.
set -euo pipefail
mode="${1:---dry-run}"
paths=(/usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/share/boost
       /usr/local/swift /usr/share/swift /usr/lib/jvm /opt/hostedtoolcache/CodeQL
       /usr/local/share/powershell /opt/microsoft/powershell)
if [[ "$mode" == --dry-run ]]; then
  printf 'Unused preinstalled SDK: %s\n' "${paths[@]}"
  printf 'Required free space before source/SDK work: 35 GiB\n'
  exit 0
fi
[[ "$mode" == --prepare || "$mode" == --check ]] || exit 2
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == Linux ]] || { echo 'Hosted Linux runner required' >&2; exit 1; }
[[ -d "${RUNNER_TEMP:?Runner temporary directory required}" ]]
if [[ "$mode" == --prepare ]]; then
  echo 'Disk before unused SDK cleanup'; df -h "$RUNNER_TEMP"
  for entry in "${paths[@]}"; do sudo du -sh -- "$entry" 2>/dev/null || true; done
  sudo rm -rf -- "${paths[@]}"
  echo 'Disk after unused SDK cleanup'; df -h "$RUNNER_TEMP"
fi
# The previous hosted run exhausted its remaining budget during installation.
# 35 GiB is a conservative preflight reserve, not a measured peak guarantee;
# actual filesystem availability is logged before and after cleanup.
available="$(df -PB1 "$RUNNER_TEMP" | awk 'NR==2 {print $4}')"
[[ "$available" =~ ^[0-9]+$ ]] || { echo 'Cannot measure build filesystem space' >&2; exit 1; }
if (( available < 35 * 1024 * 1024 * 1024 )); then
  echo "::error::Need 35 GiB free on $RUNNER_TEMP before source/SDK work; available bytes: $available" >&2
  exit 1
fi
printf 'Build filesystem available bytes: %s\n' "$available"
