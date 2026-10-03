FROM node:22-bookworm-slim
ARG SOURCE_COMMIT
ENV DSH_TAVERN_HOST=cli DSH_TAVERN_RUNTIME_HOST=cli \
    DSH_TAVERN_CLI_HOME=/data DSH_HOME=/data DSH_TAVERN_NO_OPEN=1 \
    DSH_TAVERN_PORT=3081 DSH_TAVERN_NPM_REGISTRY=https://registry.npmjs.org \
    pnpm_config_update_notifier=false
ENV PATH="/data/tools/bin:/root/.local/bin:${PATH}"
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git socat tini procps lsof python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /data/apps/dsh-tavern
COPY . .
# Install the actual checkout; install.sh re-fetches main even with TARGET_COMMIT.
RUN test -n "$SOURCE_COMMIT" \
    && npm install --global --prefix /data/tools pnpm@11.25.0 \
    && pnpm install --frozen-lockfile \
    && printf '{"commit":"%s"}\n' "$SOURCE_COMMIT" > .dsh-tavern-release.json \
    && node bin/dsh-tavern.mjs install --host cli \
    && printf '%s\n' "$SOURCE_COMMIT" > /data/.docker-image-revision \
    && mkdir /opt/tavern-seed && cp -a /data/. /opt/tavern-seed/ \
    && rm -rf /data && mkdir /data
COPY docker/entrypoint.sh /usr/local/bin/tavern-entrypoint
COPY docker/healthcheck.mjs /usr/local/lib/tavern-healthcheck.mjs
RUN chmod +x /usr/local/bin/tavern-entrypoint
WORKDIR /data
EXPOSE 3080
HEALTHCHECK --interval=15s --timeout=5s --start-period=180s --retries=4 \
    CMD ["node", "/usr/local/lib/tavern-healthcheck.mjs"]
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/tavern-entrypoint"]
