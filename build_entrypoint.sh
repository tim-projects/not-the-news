#!/usr/bin/env bash
set -e
mkdir -p /data/feed /data/user_state /data/config
chown -R appuser:appgroup /data/user_state /data/feed /app /rss
mkdir -p /data/redis && chown redis:redis /data/redis
cat <<EOF > /etc/redis.conf
dir /data/redis
save 900 1
save 300 10
appendonly yes
appendfsync always
appendfilename "appendonly.aof"
appenddirname "appendonlydir"
EOF
redis-server /etc/redis.conf --daemonize yes &
gosu appuser /venv/bin/gunicorn --chdir /app/www --bind 127.0.0.1:4575 --workers 1 --threads 3 --access-logfile /tmp/gunicorn_access.log --error-logfile /tmp/gunicorn_error.log api:app &
gosu appuser python3 /rss/run.py --daemon &
if ! caddy run --config /etc/caddy/Caddyfile --adapter caddyfile; then
  echo "Falling back to Let's Encrypt staging CA"
  export ACME_CA=https://acme-staging-v02.api.letsencrypt.org/directory
  exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi