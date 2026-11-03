#!/usr/bin/env bash
# Hosted-runner preparation only. Never remove source, build caches, Node, Rust or task SDK/container layers.
set -euo pipefail
mode="${1:---dry-run}"
paths=(/usr/local/lib/android /usr/share/dotnet /opt/ghc /usr/local/share/boost
       /usr/local/swift /usr/share/swift /usr/lib/jvm /opt/hostedtoolcache/CodeQL
       /usr/local/share/powershell /opt/microsoft/powershell
       /opt/hostedtoolcache/go /opt/hostedtoolcache/Python /opt/hostedtoolcache/PyPy
       /opt/hostedtoolcache/Ruby /opt/google/chrome /opt/microsoft/msedge
       /usr/local/share/chromium /usr/local/share/chromedriver-linux64)
# These are preloaded by actions/runner-images install-docker.sh, not used
# by this build. Remove only their named tags, never prune shared layers.
images=(ghcr.io/dependabot/dependabot-updater-core:latest
        ghcr.io/github/gh-aw-mcpg:latest ghcr.io/github/gh-aw-firewall/agent:latest
        ghcr.io/github/gh-aw-firewall/api-proxy:latest
        ghcr.io/github/gh-aw-firewall/squid:latest ghcr.io/github/github-mcp-server:latest)
if [[ "$mode" == --dry-run ]]; then
  printf 'Unused preinstalled SDK: %s\n' "${paths[@]}"
  printf 'Unused preloaded image: %s\n' "${images[@]}"
  printf 'Required free space before preparation: 48 GiB; before SDK compilation: 35 GiB\n'
  exit 0
fi
[[ "$mode" == --prepare || "$mode" == --check || "$mode" == --report ]] || exit 2
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_ENVIRONMENT:-}" == github-hosted && "${RUNNER_OS:-}" == Linux ]] || { echo 'Hosted Linux runner required' >&2; exit 1; }
[[ -d "${RUNNER_TEMP:?Runner temporary directory required}" ]]
echo "Disk stage: $mode ${2:-}"
df -PB1 "$RUNNER_TEMP"
if [[ "$mode" == --prepare ]]; then
  # Python3 is used by host source checks/checkpoints. Never delete its active
  # interpreter; /usr/bin/python3 is retained alongside all system libraries.
  python="$(readlink -f "$(command -v python3)")"
  node="$(readlink -f "$(command -v node)")"
  for entry in "${paths[@]}"; do
    [[ "$python" != "$entry" && "$python" != "$entry/"* && "$node" != "$entry" && "$node" != "$entry/"* ]] || { echo "Active interpreter in cleanup path: $entry" >&2; exit 1; }
  done
  /usr/bin/python3 --version
  echo 'Disk before unused SDK cleanup'; df -PB1 "$RUNNER_TEMP"
  for entry in "${paths[@]}"; do sudo du -sh -- "$entry" 2>/dev/null || true; done
  sudo rm -rf -- "${paths[@]}"
  if command -v docker >/dev/null; then
    docker image ls --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.Size}}'
    for image in "${images[@]}"; do
      if docker image inspect --format '{{.Id}} {{.Size}}' "$image" 2>/dev/null; then
        containers="$(docker ps -aq --filter "ancestor=$image")"
        if [[ -n "$containers" ]]; then
          echo "Retaining referenced preloaded image: $image"
        else
          # No force: Docker also rejects a concurrent container reference.
          docker image rm -- "$image" || echo "Retained image in use: $image"
        fi
      fi
    done
  fi
  echo 'Disk after unused SDK cleanup'; df -PB1 "$RUNNER_TEMP"
fi
# Run 41593325036 consumed 12,816,171,008 bytes between cleanup and compile
# (source checkout, host prerequisites, auxiliary input and compiler cache).
# Reserve 13 GiB preparation space in addition to the unchanged 35 GiB SDK
# reserve. Neither reserve claims a measured full-build peak guarantee.
minimum=35
[[ "$mode" != --prepare ]] || minimum=48
if [[ "$mode" != --prepare ]]; then
  for entry in "${GITHUB_WORKSPACE:-}/.git" "${GITHUB_WORKSPACE:-}" "$RUNNER_TEMP/nexus-auxiliary" "$RUNNER_TEMP/nexus-ccache" "$RUNNER_TEMP/nexus-cargo" "$RUNNER_TEMP/nexus-work" "$RUNNER_TEMP/nexus-output"; do
    [[ ! -e "$entry" || "$entry" == / || "$entry" == /.git ]] || du -sx -B1 -- "$entry"
  done
fi
[[ "$mode" != --report ]] || exit 0
available="$(df -PB1 "$RUNNER_TEMP" | awk 'NR==2 {print $4}')"
[[ "$available" =~ ^[0-9]+$ ]] || { echo 'Cannot measure build filesystem space' >&2; exit 1; }
if (( available < minimum * 1024 * 1024 * 1024 )); then
  echo "::error::Need $minimum GiB free on $RUNNER_TEMP at $mode; available bytes: $available" >&2
  exit 1
fi
printf 'Build filesystem available bytes: %s\n' "$available"
