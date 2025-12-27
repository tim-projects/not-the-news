#!/usr/bin/env bash
set -e
mkdir -p /data/feed /data/user_state /data/config /etc/caddy/certs
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
gosu appuser /venv/bin/gunicorn --chdir /app --bind 0.0.0.0:4575 --workers 1 \
--threads 3 --access-logfile - --error-logfile - src.api:app --log-level info &

# Start the Cloudflare Worker locally using Wrangler
cd /app/worker && gosu appuser npm install && gosu appuser env HOME=/tmp npx wrangler dev --port 8787 --ip 0.0.0.0 --var APP_PASSWORD:$APP_PASSWORD &
cd /app

gosu appuser /venv/bin/python3 /rss/run.py --daemon > /tmp/rss_run.log 2>&1 &
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
wait