#!/usr/bin/env bash
# Playwright on Cloud Agent VMs: some specs call `docker exec` against the local DB container.
# Re-exec inside the docker group when the session has not picked up group membership yet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$ROOT"

run_e2e() {
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" npm run test:e2e -- "$@"
}

in_docker_group() {
  local user="${USER:-$(id -un)}"
  getent group docker 2>/dev/null | grep -qE "[,:]${user}([,]|$)"
}

wait_for_docker() {
  if ! docker info >/dev/null 2>&1; then
    sudo service docker start 2>/dev/null || true
  fi
  for _ in $(seq 1 90); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo '[test-e2e-agent] Docker daemon not available' >&2
  return 1
}

if docker info >/dev/null 2>&1; then
  run_e2e "$@"
  exit $?
fi

if ! id -nG | grep -qw docker && in_docker_group; then
  quoted=""
  for arg in "$@"; do
    quoted+=" $(printf '%q' "$arg")"
  done
  exec sg docker -c "cd $(printf '%q' "$ROOT") && NODE_OPTIONS=$(printf '%q' "${NODE_OPTIONS:---max-old-space-size=8192}") bash $(printf '%q' "$SELF")${quoted}"
fi

if in_docker_group || id -nG | grep -qw docker; then
  wait_for_docker
  run_e2e "$@"
  exit $?
fi

echo '[test-e2e-agent] docker group not available; run on an environment with .cursor/Dockerfile' >&2
exit 1