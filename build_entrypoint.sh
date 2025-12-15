#!/usr/bin/env bash
set -e
mkdir -p /data/feed /data/user_state /data/config /etc/caddy/certs
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile

# Wait for all background processes to finish
wait