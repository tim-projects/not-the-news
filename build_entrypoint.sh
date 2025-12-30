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
    # We rely on variables already being in environment from --env-file or -e
    # but we can source it if needed, though simple 'source' is often safer than 'export $(...)'
    # For now, since build-dev.sh uses --env-file, we don't need to manually parse it here.
    
    # Map VITE_ variables to worker-expected names
# Remove potential surrounding quotes from the values (happens with some env parsers)
export FIREBASE_PROJECT_ID=$(echo ${VITE_FIREBASE_PROJECT_ID:-$FIREBASE_PROJECT_ID} | sed 's/^"//;s/"$//')
export FIREBASE_SERVICE_ACCOUNT_EMAIL=$(echo ${FIREBASE_SERVICE_ACCOUNT_EMAIL} | sed 's/^"//;s/"$//')
export FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY=$(echo "${FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY}" | sed 's/^"//;s/"$//')
export API_BASE_URL=$(echo ${VITE_API_BASE_URL:-$API_BASE_URL} | sed 's/^"//;s/"$//')

echo "[Entrypoint] Fixing asset permissions..."
    # We must ensure we can write to these files even if built by root
    chown -R appuser:appgroup /app/www/


    echo "[Entrypoint] Debug: FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID"
    echo "[Entrypoint] Debug: API_BASE_URL=$API_BASE_URL"
    echo "[Entrypoint] Debug: FIREBASE_SERVICE_ACCOUNT_EMAIL=$FIREBASE_SERVICE_ACCOUNT_EMAIL"
    if [ -n "$FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" ]; then
        echo "[Entrypoint] Debug: FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is set (length: ${#FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY})"
    else
        echo "[Entrypoint] Debug: FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY is NOT set"
    fi
fi

# Start the Cloudflare Worker locally using Wrangler
cd /app/worker
# Fix wrangler.jsonc to include the real values for local dev if they aren't being picked up
# We use a temp file to avoid sed issues with large multiline keys
cat wrangler.jsonc | \
  sed "s|\"APP_PASSWORD\": \"\"|\"APP_PASSWORD\": \"$APP_PASSWORD\"|g" | \
  sed "s|\"FIREBASE_PROJECT_ID\": \"\"|\"FIREBASE_PROJECT_ID\": \"$FIREBASE_PROJECT_ID\"|g" | \
  sed "s|\"FIREBASE_SERVICE_ACCOUNT_EMAIL\": \"\"|\"FIREBASE_SERVICE_ACCOUNT_EMAIL\": \"$FIREBASE_SERVICE_ACCOUNT_EMAIL\"|g" \
  > wrangler.jsonc.tmp

# Handle the private key carefully as it has newlines
# We use python or node for this to be safe
node -e "
const fs = require('fs');
let config = fs.readFileSync('wrangler.jsonc.tmp', 'utf8');
const key = process.env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;
config = config.replace('\"FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY\": \"\"', '\"FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY\": ' + JSON.stringify(key));
fs.writeFileSync('wrangler.jsonc', config);
"

gosu appuser npm install && gosu appuser env HOME=/tmp npx wrangler dev --port 8787 --ip 0.0.0.0 &

# Run seed script in background (will wait for worker)
gosu appuser node /app/seed_config.js &

cd /app
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile