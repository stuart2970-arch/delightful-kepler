# Cursor Cloud Agent base: Docker-in-Docker for local Supabase CLI (STYL-210).
# Do not COPY the repo; Cursor checks out code after the image is built.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    sudo \
    git \
    && rm -rf /var/lib/apt/lists/*

########################################################
# Docker (fuse-overlayfs + iptables-legacy for nested VMs)
# https://cursor.com/docs/cloud-agent/setup#running-docker
########################################################
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && \
    apt-get install -y \
    docker-ce=5:28.5.2-1~ubuntu.24.04~noble \
    docker-ce-cli=5:28.5.2-1~ubuntu.24.04~noble \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

RUN apt-get update && apt-get install -y -o Dpkg::Options::="--force-confold" fuse3 fuse-overlayfs iptables && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /etc/docker && \
    printf '%s\n' '{' \
    '  "storage-driver": "fuse-overlayfs"' \
    '}' > /etc/docker/daemon.json
RUN update-alternatives --set iptables /usr/sbin/iptables-legacy && \
    update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

########################################################
# Node.js 22 (matches package.json engines)
########################################################
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

########################################################
# Non-root agent user
########################################################
RUN id -u ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu
RUN groupadd -f docker && usermod -aG docker ubuntu && usermod -aG sudo ubuntu
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu