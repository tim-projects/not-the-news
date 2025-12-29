#!/usr/bin/env bash
set -e
mkdir -p /data/feed /data/user_state /data/config /etc/caddy/certs
chown -R appuser:appgroup /data/user_state /data/feed /data/config
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

# Create seed script
cat <<EOF > /app/seed_config.js
const fs = require('fs');
const http = require('http');

const feedsPath = '/data/config/rssFeeds.json';
const blacklistPath = '/data/config/keywordBlacklist.json';

console.log('[Seed] Checking for config files...');
const config = {};

if (fs.existsSync(feedsPath)) {
    try {
        console.log('[Seed] Found rssFeeds.json, reading...');
        const data = JSON.parse(fs.readFileSync(feedsPath, 'utf8'));
        if (data.value) {
            config.rssFeeds = data.value;
            console.log('[Seed] Loaded rssFeeds for seeding');
        } else {
            console.warn('[Seed] rssFeeds.json found but no "value" property');
        }
    } catch(e) { console.error('[Seed] Error reading feeds', e); }
} else {
    console.log('[Seed] rssFeeds.json not found at ' + feedsPath);
}

if (fs.existsSync(blacklistPath)) {
    try {
        console.log('[Seed] Found keywordBlacklist.json, reading...');
        const data = JSON.parse(fs.readFileSync(blacklistPath, 'utf8'));
        if (data.value) {
            config.keywordBlacklist = data.value;
            console.log('[Seed] Loaded keywordBlacklist for seeding');
        } else {
            console.warn('[Seed] keywordBlacklist.json found but no "value" property');
        }
    } catch(e) { console.error('[Seed] Error reading blacklist', e); }
} else {
    console.log('[Seed] keywordBlacklist.json not found at ' + blacklistPath);
}

if (Object.keys(config).length === 0) {
    console.log('[Seed] No config to seed. Current /data/config contains: ' + fs.readdirSync('/data/config').join(', '));
    process.exit(0);
}

const payload = JSON.stringify(config);

function tryPost() {
    console.log('[Seed] Attempting to POST config to worker...');
    const req = http.request({
        hostname: '127.0.0.1',
        port: 8787,
        path: '/api/admin/config-restore',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': 'auth=seeding',
            'Content-Length': Buffer.byteLength(payload)
        }
    }, (res) => {
        console.log('[Seed] Response status:', res.statusCode);
        if (res.statusCode === 200) {
            console.log('[Seed] Configuration successfully seeded.');
            process.exit(0);
        }
        else {
            console.error('[Seed] Failed to seed configuration. Status:', res.statusCode);
            process.exit(1);
        }
    });

    req.on('error', (e) => {
        console.log('[Seed] Worker not ready yet (' + e.message + '), retrying in 2s...');
        setTimeout(tryPost, 2000);
    });

    req.write(payload);
    req.end();
}

console.log('[Seed] Starting seed process...');
tryPost();
EOF

# Ensure ./data exists in worker directory
mkdir -p /app/worker/data/user_state
chown -R appuser:appgroup /app/worker/data

# Load environment variables from .env if it exists
if [ -f "/app/.env" ]; then
    echo "[Entrypoint] Loading .env file..."
    # Export VITE_ variables and also map them to worker-expected names
    export $(grep -v '^#' /app/.env | xargs)
    export FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
    export FIREBASE_SERVICE_ACCOUNT_EMAIL=${FIREBASE_SERVICE_ACCOUNT_EMAIL}
    export FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY=${FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY}
fi

# Start the Cloudflare Worker locally using Wrangler
cd /app/worker && gosu appuser npm install && gosu appuser env HOME=/tmp \
    APP_PASSWORD=$APP_PASSWORD \
    FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    FIREBASE_SERVICE_ACCOUNT_EMAIL=$FIREBASE_SERVICE_ACCOUNT_EMAIL \
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY="$FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" \
    npx wrangler dev --port 8787 --ip 0.0.0.0 &

# Run seed script in background (will wait for worker)
gosu appuser node /app/seed_config.js &

cd /app
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile