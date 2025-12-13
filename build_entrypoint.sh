#!/usr/bin/env bash
set -e
mkdir -p /data/feed /data/user_state /data/config
chown -R appuser:appgroup /data/user_state /data/feed
mkdir -p /data/redis && chown redis:redis /data/redis
cat <<EOF > /etc/redis.conf
dir /data/redis
port 6380
save 900 1
save 300 10
appendonly yes
appendfsync always
appendfilename "appendonly.aof"
appenddirname "appendonlydir"
EOF
redis-server /etc/redis.conf &
# Execute reconstruct_api.py after mounting, before Gunicorn starts
gosu appuser /venv/bin/python3 /tmp/reconstruct_api.py
gosu appuser /venv/bin/gunicorn --chdir /app --bind 127.0.0.1:4575 --workers 1 --threads 3 --access-logfile /tmp/gunicorn_access.log --error-logfile /tmp/gunicorn_error.log --reload src.api:app &
gosu appuser python3 /rss/run.py --daemon > /tmp/rss_run.log 2>&1 &
if ! strace -f -o /tmp/caddy_strace_1.log caddy run --config /etc/caddy/Caddyfile --adapter caddyfile; then
  echo "Falling back to Let's Encrypt staging CA"
  export ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
  exec strace -f -o /tmp/caddy_strace_2.log caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi