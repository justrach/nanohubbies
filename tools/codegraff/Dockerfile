# Digest-pinned official toolchains. Bun manages dependencies; Node runs the
# existing node:test/Miniflare integration harnesses.
FROM oven/bun:1.4.4@sha256:1d22548f177f4ff38e0c15baa3c2c46c6c2060ba2d1bc573bb4720b407548f1d AS bun
FROM node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
# Package management is exclusively Bun.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV HOME=/home/node BUN_INSTALL_CACHE_DIR=/home/node/.bun/install/cache
RUN mkdir -p /home/node/prewarm && chown node:node /home/node/prewarm
USER node
WORKDIR /home/node/prewarm
# Context allowlist excludes source, local credentials and Git history.
COPY --chown=node:node package.json bun.lock ./
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node packages/api/package.json ./packages/api/package.json
COPY --chown=node:node packages/vault/package.json ./packages/vault/package.json
COPY --chown=node:node packages/cli/package.json ./packages/cli/package.json
RUN git --version && bash --version && node --version && command -v ssh-keygen && gpg --version && gpgconf --version && test "$(bun --version)" = "1.4.4" \
    && bun install --frozen-lockfile \
    && rm -rf node_modules apps packages package.json bun.lock
WORKDIR /tmp
