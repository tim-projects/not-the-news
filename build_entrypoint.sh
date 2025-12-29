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
    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ $line =~ ^#.*$ ]] && continue
        [[ -z $line ]] && continue
        
        # Split into key and value
        key=$(echo "$line" | cut -d '=' -f 1)
        value=$(echo "$line" | cut -d '=' -f 2- | sed 's/^"//;s/"$//')
        
        export "$key"="$value"
    done < "/app/.env"

    # Map VITE_ variables to worker-expected names
    export FIREBASE_PROJECT_ID=${VITE_FIREBASE_PROJECT_ID}
    export FIREBASE_SERVICE_ACCOUNT_EMAIL=${FIREBASE_SERVICE_ACCOUNT_EMAIL}
    export FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY=${FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY}
    export API_BASE_URL=${VITE_API_BASE_URL}
    
    echo "[Entrypoint] Fixing asset permissions and injecting Firebase config..."
    # We must ensure we can write to these files even if built by root
    chown -R appuser:appgroup /app/www/
    
    # We target ALL files in /app/www/ to be absolutely sure
    # We use a pattern that matches the placeholder exactly
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_API_KEY_PLACEHOLDER|$VITE_FIREBASE_API_KEY|g" {} +
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_AUTH_DOMAIN_PLACEHOLDER|$VITE_FIREBASE_AUTH_DOMAIN|g" {} +
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_PROJECT_ID_PLACEHOLDER|$VITE_FIREBASE_PROJECT_ID|g" {} +
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_STORAGE_BUCKET_PLACEHOLDER|$VITE_FIREBASE_STORAGE_BUCKET|g" {} +
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_MESSAGING_SENDER_ID_PLACEHOLDER|$VITE_FIREBASE_MESSAGING_SENDER_ID|g" {} +
    find /app/www/ -type f -exec sed -i "s|VITE_FIREBASE_APP_ID_PLACEHOLDER|$VITE_FIREBASE_APP_ID|g" {} +

    # VERIFICATION - check if the injection happened in the config object specifically
    echo "[Entrypoint] Verifying injection..."
    if grep -r "apiKey:\"AIzaSy" /app/www/assets/ > /dev/null; then
        echo "[Entrypoint] SUCCESS: Firebase API Key found in built assets!"
    else
        echo "[Entrypoint] ERROR: API Key NOT found in assets!"
        exit 1
    fi
    
    echo "[Entrypoint] Injection Proof (first match):"
    FILE_MATCH=$(grep -l "AIzaSy" /app/www/assets/*.js | head -n 1)
    if [ -n "$FILE_MATCH" ]; then
        grep -o "apiKey:\"AIzaSy[^\"]*\"" "$FILE_MATCH"
    else
        echo "[Entrypoint] ERROR: API Key NOT FOUND in assets!"
    fi

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
cd /app/worker && gosu appuser npm install && gosu appuser env HOME=/tmp \
    APP_PASSWORD=$APP_PASSWORD \
    FIREBASE_PROJECT_ID=$FIREBASE_PROJECT_ID \
    FIREBASE_SERVICE_ACCOUNT_EMAIL=$FIREBASE_SERVICE_ACCOUNT_EMAIL \
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY="$FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY" \
    API_BASE_URL=$API_BASE_URL \
    npx wrangler dev --port 8787 --ip 0.0.0.0 &

# Run seed script in background (will wait for worker)
gosu appuser node /app/seed_config.js &

cd /app
caddy run --config /etc/caddy/Caddyfile --adapter caddyfile