#!/usr/bin/env bash
# Idempotent Cursor Cloud Agent install: Docker CE, deps, pre-pull local Supabase images.
# Runs from repository root (see .cursor/environment.json install).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
cd "$ROOT"

SUPABASE_CLI_VERSION="${SUPABASE_CLI_VERSION:-3.2.0}"
DOCKER_CE_PKG_VERSION='5:28.5.2-1~ubuntu.24.04~noble'

log() {
  printf '[agent-install] %s\n' "$*"
}

in_docker_group() {
  local user="${USER:-$(id -un)}"
  getent group docker 2>/dev/null | grep -qE "[,:]${user}([,]|$)"
}

maybe_reexec_in_docker_group() {
  if [[ -n "${DELIGHTFUL_AGENT_SG_DOCKER:-}" ]]; then
    return 0
  fi
  if docker info >/dev/null 2>&1; then
    return 0
  fi
  if id -nG | grep -qw docker; then
    return 0
  fi
  if ! in_docker_group; then
    return 0
  fi
  log 'Re-running inside docker group (sg docker)'
  exec sg docker -c "export DELIGHTFUL_AGENT_SG_DOCKER=1; cd $(printf '%q' "$ROOT") && bash $(printf '%q' "$SELF")"
}

ensure_docker_nested_config() {
  if ! dpkg -s fuse-overlayfs >/dev/null 2>&1; then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::="--force-confold" \
      fuse3 fuse-overlayfs iptables
  fi

  if [[ ! -f /etc/docker/daemon.json ]]; then
    sudo mkdir -p /etc/docker
    printf '%s\n' '{' '  "storage-driver": "fuse-overlayfs"' '}' | sudo tee /etc/docker/daemon.json > /dev/null
  fi

  if sudo update-alternatives --query iptables 2>/dev/null \
    | grep -q '/usr/sbin/iptables-nft'; then
    sudo update-alternatives --set iptables /usr/sbin/iptables-legacy
    sudo update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy
  fi
}

ensure_docker_installed() {
  if dpkg -s docker-ce >/dev/null 2>&1; then
    log 'Docker CE already installed'
    ensure_docker_nested_config
    return 0
  fi

  log 'Installing Docker CE and Compose (pinned 28.5.2)'
  sudo install -m 0755 -d /etc/apt/keyrings
  curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  local arch codename
  arch="$(dpkg --print-architecture)"
  codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
  echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
${codename} stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    docker-ce="${DOCKER_CE_PKG_VERSION}" \
    docker-ce-cli="${DOCKER_CE_PKG_VERSION}" \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

  ensure_docker_nested_config

  sudo groupadd -f docker
  local user="${USER:-$(id -un)}"
  if ! id -nG "$user" | grep -qw docker; then
    sudo usermod -aG docker "$user"
    log "Added ${user} to docker group (effective after re-login or sg docker)"
  fi

  sudo service docker start 2>/dev/null || true
}

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

maybe_reexec_in_docker_group
ensure_docker_installed
maybe_reexec_in_docker_group

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