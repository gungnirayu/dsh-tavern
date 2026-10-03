#!/bin/bash
set -Eeuo pipefail
seed=/opt/tavern-seed
app=/data/apps/dsh-tavern/bin/dsh-tavern.mjs
revision=$(cat "$seed/.docker-image-revision")
mkdir -p /data
if [[ ! -f /data/.docker-image-revision ]]; then
    # Do not overwrite an unrelated/existing installation.
    if find /data -mindepth 1 -maxdepth 1 ! -name lost+found -print -quit | read -r _; then
        echo "ERROR: /data must be empty for first initialization." >&2
        exit 1
    fi
    cp -a "$seed/." /data/
elif [[ $(cat /data/.docker-image-revision) != "$revision" ]]; then
    # Full snapshot before upstream migrations; includes credentials, keep private.
    backup="/data/backups/docker-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar"
    mkdir -p /data/backups
    tar --exclude=./backups -cf "$backup" -C /data .
    echo "Upgrade backup: $backup"
    # Only replace managed program trees; upstream merges profile configuration.
    for entry in apps runtime tools; do
        rm -rf "/data/$entry"
        cp -a "$seed/$entry" "/data/$entry"
    done
    rm -f /data/logs/tavern.pid.json
    node "$app" install --host cli
    cp "$seed/.docker-image-revision" /data/.docker-image-revision
fi
mkdir -p /data/logs
rm -f /data/logs/tavern.pid.json
proxy_pid= log_pid= monitor_pid=
cleanup() {
    trap - EXIT TERM INT
    [[ -z "$monitor_pid" ]] || kill "$monitor_pid" 2>/dev/null || true
    [[ -z "$proxy_pid" ]] || kill "$proxy_pid" 2>/dev/null || true
    [[ -z "$log_pid" ]] || kill "$log_pid" 2>/dev/null || true
    node "$app" stop || true
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
touch /data/logs/tavern.log
tail -n 0 -F /data/logs/tavern.log &
log_pid=$!
node "$app" start
socat TCP-LISTEN:3080,reuseaddr,fork,bind=0.0.0.0 "TCP:127.0.0.1:${DSH_TAVERN_PORT:-3081}" &
proxy_pid=$!
# A failed service must stop the container so restart: unless-stopped can recover.
(
    failures=0
    while sleep 15; do
        if node /usr/local/lib/tavern-healthcheck.mjs; then failures=0; else failures=$((failures + 1)); fi
        if (( failures >= 4 )); then exit 1; fi
    done
) &
monitor_pid=$!
set +e
wait -n "$proxy_pid" "$monitor_pid" "$log_pid"
exit 1
