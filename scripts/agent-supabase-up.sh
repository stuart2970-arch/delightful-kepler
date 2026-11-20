#!/usr/bin/env bash
# Start local Supabase CLI stack, reset DB (local only), write .env.test — for Cursor Cloud Agents.
# Never targets live (tkoasyjvrgaglofpzduq) or staging cloud (lriugykhrfnnouexqqhm).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LIVE_REF='tkoasyjvrgaglofpzduq'
STAGING_REF='lriugykhrfnnouexqqhm'
SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-3.2.0}"

log() {
  printf '[agent-supabase-up] %s\n' "$*"
}

# Session may not have an active `docker` group (common right after image build).
in_docker_group() {
  local user="${USER:-ubuntu}"
  getent group docker 2>/dev/null | grep -qE "[,:]${user}([,]|$)"
}

if ! docker info >/dev/null 2>&1 && in_docker_group; then
  log 'Re-running inside docker group (sg docker)'
  exec sg docker -c "cd '$ROOT' && bash '$0'"
fi

refuse_remote_env() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  if grep -qiE "${LIVE_REF}|${STAGING_REF}|\.supabase\.co" "$file"; then
    log "Refusing: ${file} points at a remote Supabase project"
    exit 1
  fi
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
  log 'Docker daemon not available'
  exit 1
}

start_supabase_with_retries() {
  local attempt=1
  local max=5
  local delay=15
  local cli=(npx "supabase@${SUPABASE_CLI_VERSION}")

  while [[ "$attempt" -le "$max" ]]; do
    log "supabase start attempt ${attempt}/${max}"
    if "${cli[@]}" start --ignore-health-check; then
      return 0
    fi
    "${cli[@]}" stop --no-backup 2>/dev/null || true
    attempt=$((attempt + 1))
    sleep "$delay"
    delay=$((delay < 60 ? delay * 2 : 60))
  done
  log 'supabase start failed after retries'
  return 1
}

SECONDS=0
wait_for_docker
refuse_remote_env .env.test
refuse_remote_env .env.local

start_supabase_with_retries

log 'Local db reset (migrations + seed)'
if ! npx "supabase@${SUPABASE_CLI_VERSION}" db reset --yes; then
  log 'db reset failed'
  exit 1
fi

npm run env:local
refuse_remote_env .env.test

log "Supabase ready in ${SECONDS}s; env written to .env.local and .env.test (keys not printed)"
npx "supabase@${SUPABASE_CLI_VERSION}" status -o json | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try {
      const s=JSON.parse(d);
      const pick=(...k)=>{for(const x of k) if(s[x]) return s[x]};
      console.log('[agent-supabase-up] API_URL=' + (pick('API_URL','apiUrl')||'unknown'));
      console.log('[agent-supabase-up] MAILPIT_URL=' + (pick('MAILPIT_URL','mailpitUrl')||'unknown'));
    } catch { console.log('[agent-supabase-up] status: ok (parse skipped)'); }
  });
"