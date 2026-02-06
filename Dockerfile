FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN OPENCLAW_A2UI_SKIP_MISSING=1 pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Writable state dir for gateway (lock, sessions, etc.) when running as node user
RUN mkdir -p /app/state && chown -R node:node /app/state

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Fly/container: must listen on 0.0.0.0:8080 so fly-proxy can reach the app.
# OpenClaw gateway exposes /tools/invoke (EDON Gateway calls this for Telegram bot).
# Set OPENCLAW_GATEWAY_TOKEN on Fly; --bind lan = listen on 0.0.0.0.
# OPENCLAW_STATE_DIR so gateway lock/config paths are writable (no reliance on $HOME).
# OPENCLAW_ALLOW_UNCONFIGURED_GATEWAY=1 so gateway starts without a config file (CLI --allow-unconfigured may not reach run subcommand).
ENV PORT=8080
ENV OPENCLAW_STATE_DIR=/app/state
ENV OPENCLAW_ALLOW_UNCONFIGURED_GATEWAY=1
EXPOSE 8080
# Shell form so startup is logged; exec keeps node as PID 1 for signals
CMD exec node dist/index.js gateway run --allow-unconfigured --port 8080 --bind lan
