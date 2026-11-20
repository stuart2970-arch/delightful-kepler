#!/usr/bin/env bash
# Playwright on Cloud Agent VMs: some specs call `docker exec` against the local DB container.
# Re-exec inside the docker group when the session has not picked up group membership yet.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

run_e2e() {
  NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}" npm run test:e2e -- "$@"
}

in_docker_group() {
  local user="${USER:-ubuntu}"
  getent group docker 2>/dev/null | grep -qE "[,:]${user}([,]|$)"
}

if docker info >/dev/null 2>&1; then
  run_e2e "$@"
  exit $?
fi

if in_docker_group; then
  quoted=""
  for arg in "$@"; do
    quoted+=" $(printf '%q' "$arg")"
  done
  exec sg docker -c "cd $(printf '%q' "$ROOT") && NODE_OPTIONS=$(printf '%q' "${NODE_OPTIONS:---max-old-space-size=8192}") npm run test:e2e --${quoted}"
fi

echo '[test-e2e-agent] docker group not available; run on an environment with .cursor/Dockerfile' >&2
exit 1