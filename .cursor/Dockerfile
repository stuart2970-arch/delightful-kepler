# Cursor Cloud Agent base: Node 22; Docker installed at runtime via .cursor/agent-install.sh (STYL-402).
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
# Node.js 22 (matches package.json engines)
########################################################
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

########################################################
# Non-root agent user (docker group + packages added by agent-install.sh)
########################################################
RUN id -u ubuntu &>/dev/null || useradd -m -s /bin/bash ubuntu
RUN groupadd -f docker && usermod -aG docker ubuntu && usermod -aG sudo ubuntu
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu

USER ubuntu
WORKDIR /home/ubuntu