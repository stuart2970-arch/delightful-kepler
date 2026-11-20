#!/usr/bin/env bash
# Idempotent Cursor Cloud Agent install: deps + pre-pull local Supabase images.
# Runs from repository root (see .cursor/environment.json install).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$ROOT"

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-3.2.0}"

log() {
  printf '[agent-install] %s\n' "$*"
}

in_docker_group() {
  local user="${USER:-$(id -un)}"
  getent group docker 2>/dev/null | grep -qE "[,:]${user}([,]|$)"
}

if ! docker info >/dev/null 2>&1 && ! id -nG | grep -qw docker && in_docker_group; then
  log 'Re-running inside docker group (sg docker)'
  exec sg docker -c "cd $(printf '%q' "$ROOT") && bash $(printf '%q' "$SELF")"
fi

wait_for_docker() {
  if sudo service docker start 2>/dev/null; then
    log 'Started docker service'
  fi
  for _ in $(seq 1 120); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  log 'ERROR: Docker daemon not ready after 120s'
  return 1
}

log "Node $(node -v); npm $(npm -v)"
wait_for_docker

if ! docker run --rm hello-world >/dev/null 2>&1; then
  log 'WARN: docker run hello-world failed; continuing anyway'
fi

log 'npm ci'
npm ci

log "Install Playwright Chromium (for install-time validation)"
npx playwright install --with-deps chromium

log "Pre-pull Supabase images via CLI ${SUPABASE_CLI_VERSION}"
if npx "supabase@${SUPABASE_CLI_VERSION}" start --ignore-health-check; then
  log 'Supabase start succeeded during image warm-up'
  npx "supabase@${SUPABASE_CLI_VERSION}" stop --no-backup || true
else
  log 'WARN: Supabase start during install failed; agents should retry via scripts/agent-supabase-up.sh'
  npx "supabase@${SUPABASE_CLI_VERSION}" stop --no-backup 2>/dev/null || true
fi

log 'Install complete'