import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, PendingOperation } from '../../src/types/app';
import { processFeeds, FeedItem } from './rss';
import * as jose from 'jose';

// Minimal types for the worker
interface Env {
    APP_PASSWORD?: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
}

/**
 * Helper to get a Google OAuth2 Access Token for Firestore
 */
async function getGoogleAccessToken(env: Env): Promise<string> {
    const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;

    console.log(`[Auth] Attempting token for: ${email}`);
    if (privateKey) {
        console.log(`[Auth] Private key length: ${privateKey.length}, starts with: ${privateKey.substring(0, 20)}`);
    }

    if (!email || !privateKey) {
        throw new Error("Missing Firestore Service Account credentials in environment.");
    }

    const cleanedKey = privateKey.replace(/\\n/g, '\n');
    const algorithm = 'RS256';
    const pkcs8 = await jose.importPKCS8(cleanedKey, algorithm);

    const jwt = await new jose.SignJWT({
        scope: 'https://www.googleapis.com/auth/datastore',
    })
        .setProtectedHeader({ alg: algorithm })
        .setIssuer(email)
        .setSubject(email)
        .setAudience('https://oauth2.googleapis.com/token')
        .setExpirationTime('1h')
        .setIssuedAt()
        .sign(pkcs8);

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    const data: any = await response.json();
    if (!data.access_token) {
        throw new Error(`Failed to get Google Access Token: ${JSON.stringify(data)}`);
    }
    return data.access_token;
}

class Storage {
    static memCache: Record<string, any> = {};

    /**
     * Firestore Helper: Convert any value to Firestore JSON format
     */
    static toFirestoreValue(value: any): any {
        if (value === null || value === undefined) return { nullValue: null };
        if (typeof value === 'boolean') return { booleanValue: value };
        if (typeof value === 'number') return { doubleValue: value };
        if (typeof value === 'string') return { stringValue: value };
        if (Array.isArray(value)) return { arrayValue: { values: value.map(v => this.toFirestoreValue(v)) } };
        if (typeof value === 'object') {
            const fields: Record<string, any> = {};
            for (const k in value) {
                fields[k] = this.toFirestoreValue(value[k]);
            }
            return { mapValue: { fields } };
        }
        return { stringValue: String(value) };
    }

    /**
     * Firestore Helper: Parse Firestore JSON format back to JS
     */
    static fromFirestoreValue(fValue: any): any {
        if ('nullValue' in fValue) return null;
        if ('booleanValue' in fValue) return fValue.booleanValue;
        if ('doubleValue' in fValue) return fValue.doubleValue;
        if ('integerValue' in fValue) return parseInt(fValue.integerValue);
        if ('stringValue' in fValue) return fValue.stringValue;
        if ('arrayValue' in fValue) return (fValue.arrayValue.values || []).map((v: any) => this.fromFirestoreValue(v));
        if ('mapValue' in fValue) {
            const result: Record<string, any> = {};
            const fields = fValue.mapValue.fields || {};
            for (const k in fields) {
                result[k] = this.fromFirestoreValue(fields[k]);
            }
            return result;
        }
        return null;
    }

    static async loadState(uid: string, key: string, env: Env): Promise<{ value: any, lastModified: string | null }> {
        const cacheKey = `${uid}:${key}`;
        if (this.memCache[cacheKey]) return this.memCache[cacheKey];

        const projectId = env.FIREBASE_PROJECT_ID;
        const token = await getGoogleAccessToken(env);
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/state/${key}`;

        console.log(`[Firestore] GET ${url}`);
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 404) {
            console.log(`[Firestore] ${key} not found (404), using defaults.`);
            const def = USER_STATE_SERVER_DEFAULTS[key];
            return { value: def ? def.default : null, lastModified: null };
        }

        if (!response.ok) {
            const errBody = await response.text();
            console.error(`[Firestore] Load Error ${response.status} for ${key}: ${errBody}`);
            const def = USER_STATE_SERVER_DEFAULTS[key];
            return { value: def ? def.default : null, lastModified: null };
        }

        const data: any = await response.json();
        const value = this.fromFirestoreValue(data.fields.value);
        const lastModified = data.updateTime;

        const result = { value, lastModified };
        this.memCache[cacheKey] = result;
        return result;
    }

    static async saveState(uid: string, key: string, value: any, env: Env): Promise<string> {
        const projectId = env.FIREBASE_PROJECT_ID;
        const token = await getGoogleAccessToken(env);
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/state/${key}`;

        console.log(`[Firestore] PATCH ${url}`);
        const firestoreData = {
            fields: {
                value: this.toFirestoreValue(value)
            }
        };

        const response = await fetch(url, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(firestoreData)
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[Firestore] Save Error ${response.status} for ${key}: ${err}`);
            return new Date().toISOString();
        }

        console.log(`[Firestore] Successfully saved ${key}`);
        const data: any = await response.json();
        const lastModified = data.updateTime;

        // Update cache
        this.memCache[`${uid}:${key}`] = { value, lastModified };
        return lastModified;
    }

    static async resetUser(uid: string, env: Env): Promise<void> {
        // Firestore REST API doesn't support deleting a whole collection easily,
        // but we can delete individual documents if we knew them.
        // For simplicity, we just clear the keys we know about.
        const keys = Object.keys(USER_STATE_SERVER_DEFAULTS);
        for (const key of keys) {
            const projectId = env.FIREBASE_PROJECT_ID;
            const token = await getGoogleAccessToken(env);
            const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/state/${key}`;
            await fetch(url, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
        }
        
        // Clear memCache
        for (const cacheKey in Storage.memCache) {
            if (cacheKey.startsWith(`${uid}:`)) {
                delete Storage.memCache[cacheKey];
            }
        }
    }
}

async function verifyFirebaseToken(token: string, projectId: string) {
    const JWKS = jose.createRemoteJWKSet(
        new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
    );

    const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
    });

    return payload;
}

// Global cache for feeds (to avoid repeated parsing)
let cachedFeedItems: FeedItem[] = [];
let lastSyncTime: string | null = null;

// Security: Simple in-memory rate limiting for sync endpoint
const syncCooldowns = new Map<string, number>();
const violationCounts = new Map<string, number>();
const BASE_COOLDOWN_MS = 30000; // 30 seconds
const MAX_FEEDS_PER_USER = 25;
const MAX_PAYLOAD_SIZE = 128 * 1024; // 128KB

const USER_STATE_SERVER_DEFAULTS: Record<string, any> = {
    'currentDeckGuids': { 'type': 'array', 'default': [] },
    'lastShuffleResetDate': { 'type': 'simple', 'default': null },
    'shuffleCount': { 'type': 'simple', 'default': 2 },
    'openUrlsInNewTabEnabled': { 'type': 'simple', 'default': true },
    'starred': { 'type': 'array', 'default': [] },
    'hidden': { 'type': 'array', 'default': [] },
    'read': { 'type': 'array', 'default': [] },
    'filterMode': { 'type': 'simple', 'default': 'unread' },
    'syncEnabled': { 'type': 'simple', 'default': true },
    'imagesEnabled': { 'type': 'simple', 'default': true },
    'fontSize': { 'type': 'simple', 'default': 100 },
    'lastStateSync': { 'type': 'simple', 'default': null },
    'lastViewedItemId': { 'type': 'simple', 'default': null },
    'lastViewedItemOffset': { 'type': 'simple', 'default': 0 },
    'theme': { 'type': 'simple', 'default': 'dark' },
    'themeStyle': { 'type': 'simple', 'default': 'originalDark' },
    'themeStyleLight': { 'type': 'simple', 'default': 'originalLight' },
    'themeStyleDark': { 'type': 'simple', 'default': 'originalDark' },
    'lastFeedSync': { 'type': 'simple', 'default': null },
    'shuffledOutGuids': { 'type': 'array', 'default': [] },
    'rssFeeds': { 
        'type': 'nested_object', 
        'default': {
            "Miscellaneous": {
                "Default": [
                    { "url": "https://news.google.com/rss?hl=en-GB&gl=GB&ceid=GB:en" },
                    { "url": "https://www.hotukdeals.com/rss/all" },
                    { "url": "https://hnrss.org/best" }
                ]
            }
        }
    },
    'keywordBlacklist': { 'type': 'array', 'default': ["Trump", "politics", "football", "/r/pictures"] },
    'customCss': { 'type': 'simple', 'default': '' },
    'shadowsEnabled': { 'type': 'simple', 'default': true },
    'curvesEnabled': { 'type': 'simple', 'default': true },
    'flickToSelectEnabled': { 'type': 'simple', 'default': false },
    'itemButtonMode': { 'type': 'simple', 'default': 'play' },
    'showSearchBar': { 'type': 'simple', 'default': false },
    'searchQuery': { 'type': 'simple', 'default': '' },
};

function jsonResponse(data: any, status: number = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, if-none-match',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            ...headers
        }
    });
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
    try {
        const data: any = await request.json();
        const submittedPw = data.password;
        const appPassword = env.APP_PASSWORD;

        if (!appPassword) {
            console.error('[Worker] APP_PASSWORD not found');
            return jsonResponse({ error: 'Server misconfigured' }, 500);
        }

        if (submittedPw !== appPassword) {
            return jsonResponse({ error: 'Invalid password' }, 401);
        }

        const authToken = crypto.randomUUID();
        const response = jsonResponse({ status: 'ok' }, 200);
        
        response.headers.append('Set-Cookie', `auth=${authToken}; Max-Age=${90*24*60*60}; HttpOnly; Secure; SameSite=Strict; Path=/`);
        return response;
    } catch (e: any) {
        return jsonResponse({ error: 'Internal server error' }, 500);
    }
}

async function syncFeeds(uid: string, env: Env): Promise<Response> {
    const { value: feedsConfig } = await Storage.loadState(uid, 'rssFeeds', env);
    const { value: blacklist } = await Storage.loadState(uid, 'keywordBlacklist', env);
    
    // Extract URLs from nested or flat config
    let feedUrls: string[] = [];
    if (Array.isArray(feedsConfig)) {
        feedUrls = feedsConfig
            .filter(f => typeof f === 'string')
            .map(f => f.trim())
            .filter(f => f.length > 0 && !f.startsWith('#'));
    } else if (feedsConfig && typeof feedsConfig === 'object') {
        // Deep extract URLs from categories
        const extract = (obj: any) => {
            for (const k in obj) {
                if (Array.isArray(obj[k])) {
                    obj[k].forEach((item: any) => {
                        if (typeof item === 'string') feedUrls.push(item);
                        else if (item.url) feedUrls.push(item.url);
                    });
                } else if (typeof obj[k] === 'object') {
                    extract(obj[k]);
                }
            }
        };
        extract(feedsConfig);
    }

    if (feedUrls.length === 0) {
        return jsonResponse({ status: 'skipped', reason: 'No feed URLs configured' });
    }

    // Security: Limit total feeds processed per sync
    const throttledUrls = feedUrls.slice(0, MAX_FEEDS_PER_USER);

    try {
        const items = await processFeeds(throttledUrls, blacklist || []);
        
        // Merge with existing global cache to avoid losing items other users might need
        const existingGuids = new Set(cachedFeedItems.map(i => i.guid));
        const newItems = items.filter(i => !existingGuids.has(i.guid));
        cachedFeedItems.push(...newItems);
        
        lastSyncTime = new Date().toISOString();
        
        return jsonResponse({ status: 'ok', count: items.length });
    } catch (error: any) {
        return jsonResponse({ error: error.message }, 500);
    }
}

async function discoverFeeds(targetUrl: string): Promise<Response> {
    try {
        const url = new URL(targetUrl);
        if (!['http:', 'https:'].includes(url.protocol)) {
            return jsonResponse({ error: 'Invalid protocol' }, 400);
        }

        // Basic SSRF Protection: Block local/internal IPs
        const hostname = url.hostname.toLowerCase();
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
            return jsonResponse({ error: 'Restricted address' }, 403);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000); // 3s for discovery

        const response = await fetch(url.href, { 
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NTN-Discovery/1.0)' }
        });
        clearTimeout(timeout);

        if (!response.ok) return jsonResponse({ error: 'Site unreachable' }, 404);

        // Limit discovery page size to 1MB
        const text = await response.text();
        if (text.length > 1024 * 1024) return jsonResponse({ error: 'Page too large' }, 413);

        const feeds: string[] = [];
        // Simple regex-based discovery for <link> tags
        const linkMatches = text.matchAll(/<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'])[^>]*>/gi);
        
        for (const match of linkMatches) {
            const hrefMatch = match[0].match(/href=["']([^"']+)["']/i);
            if (hrefMatch) {
                try {
                    const absoluteUrl = new URL(hrefMatch[1], url.href).href;
                    if (!feeds.includes(absoluteUrl)) feeds.push(absoluteUrl);
                } catch {}
            }
        }

        return jsonResponse({ feeds });
    } catch (e: any) {
        return jsonResponse({ error: 'Invalid URL or connection error' }, 400);
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const pathName = url.pathname;

        // Security: Limit payload size for all POST requests
        if (request.method === 'POST') {
            const contentLength = request.headers.get('Content-Length');
            if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
                return jsonResponse({ error: 'Payload too large' }, 413);
            }
        }

        // AUTHENTICATION LOGIC
        if (request.method === 'OPTIONS') {
            return jsonResponse({ status: 'ok' });
        }

        let uid = 'anonymous';
        const authHeader = request.headers.get('Authorization');
        const cookie = request.headers.get('Cookie');

        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            try {
                if (!env.FIREBASE_PROJECT_ID) {
                    console.error('[Worker] FIREBASE_PROJECT_ID not set');
                } else {
                    const payload = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
                    uid = payload.sub as string;
                }
            } catch (e: any) {
                console.error('[Worker] Token verification failed:', e.message);
                return new Response('Unauthorized: Invalid Token', { status: 401 });
            }
        } else if (cookie?.includes('auth=seeding')) {
            uid = 'seeding-user'; // Special UID for initial seeding
        } else if (pathName.startsWith('/api/') && pathName !== '/api/time' && pathName !== '/api/refresh') {
            if (pathName !== '/api/login') {
                 return new Response('Unauthorized: No Token Provided', { status: 401 });
            }
        }

        if (pathName === '/api/login' && request.method === 'POST') {
            return jsonResponse({ error: 'Use Firebase Auth' }, 410);
        }

        // Time endpoint
        if (pathName === '/api/time') {
            const now = new Date();
            return jsonResponse({ time: now.toISOString(), timestamp: now.getTime() });
        }

        if (pathName === '/api/refresh' && request.method === 'POST') {
            // Security: Exponential Backoff Rate Limiting
            const now = Date.now();
            const lastSync = syncCooldowns.get(uid) || 0;
            const violations = violationCounts.get(uid) || 0;
            
            // Calculate current required cooldown: BASE * (2 ^ violations)
            // Clamp violations to 10 to prevent infinite or extreme numbers (max ~8.5 hours)
            const requiredCooldown = BASE_COOLDOWN_MS * Math.pow(2, Math.min(violations, 10));
            
            if (now - lastSync < requiredCooldown) {
                // Violation: increase penalty count and reject
                violationCounts.set(uid, violations + 1);
                const retrySeconds = Math.ceil((requiredCooldown - (now - lastSync)) / 1000);
                return jsonResponse({ 
                    error: 'Sync too frequent', 
                    retryAfter: retrySeconds,
                    penaltyLevel: violations + 1
                }, 429);
            }

            // Success or patient attempt: reset violation count if they waited long enough
            // (e.g. if they waited 2x the required cooldown, they are 'clean')
            if (now - lastSync > (requiredCooldown * 2)) {
                violationCounts.delete(uid);
            }
            
            syncCooldowns.set(uid, now);
            return syncFeeds(uid, env);
        }

        if (pathName === '/api/lookup') {
            const targetUrl = url.searchParams.get('url');
            if (!targetUrl) return jsonResponse({ error: 'URL required' }, 400);
            return discoverFeeds(targetUrl);
        }

        if (pathName === '/api/keys') {
            return jsonResponse({
                guids: cachedFeedItems.map(i => i.guid),
                serverTime: lastSyncTime || new Date().toISOString()
            });
        }

        if (pathName === '/api/list') {
            let wantedGuids: string[] = [];
            if (request.method === 'POST') {
                const data: any = await request.json();
                wantedGuids = data.guids || [];
            } else {
                const guidsParam = url.searchParams.get('guids');
                wantedGuids = guidsParam ? guidsParam.split(',') : [];
            }

            // Security: Limit number of GUIDs requested in one hit
            if (wantedGuids.length > 50) {
                return jsonResponse({ error: 'Too many GUIDs requested' }, 400);
            }

            const results = wantedGuids.length > 0 
                ? cachedFeedItems.filter(i => wantedGuids.includes(i.guid))
                : cachedFeedItems;

            return jsonResponse(results);
        }

        if (pathName.startsWith('/api/profile/')) {
            const key = pathName.split('/').pop();
            if (key) {
                const state = await Storage.loadState(uid, key, env);
                if (state.value === null && !USER_STATE_SERVER_DEFAULTS[key]) {
                    return new Response('Not Found', { status: 404 });
                }
                return jsonResponse(state);
            }
        }

        if (pathName === '/api/profile' && request.method === 'POST') {
            const operations: any[] = await request.json();
            
            // Security: Limit batch size of operations
            if (operations.length > 25) {
                return jsonResponse({ error: 'Too many operations in batch' }, 400);
            }

            const results = [];
            for (const op of operations) {
                if (op.type === 'simpleUpdate') {
                    const lastModified = await Storage.saveState(uid, op.key, op.value, env);
                    results.push({ id: op.id, status: 'success', lastModified });
                } else if (op.type === 'readDelta' || op.type === 'starDelta') {
                    const key = op.type === 'readDelta' ? 'read' : 'starred';
                    const { value: current } = await Storage.loadState(uid, key, env);
                    const arr = Array.isArray(current) ? current : [];
                    const filtered = arr.filter((i: any) => i.guid !== op.guid);
                    if (op.action === 'add') {
                        filtered.push({ guid: op.guid, timestamp: new Date().toISOString() });
                    }
                    const lastModified = await Storage.saveState(uid, key, filtered, env);
                    results.push({ id: op.id, status: 'success', lastModified });
                }
            }
            return jsonResponse({ status: 'ok', results, serverTime: new Date().toISOString() });
        }

        // Admin endpoints (internal use during seed or by admins)
        if (pathName === '/api/admin/archive-export') {
            const config: Record<string, any> = {};
            for (const key in USER_STATE_SERVER_DEFAULTS) {
                const state = await Storage.loadState(uid, key, env);
                if (state.value !== null) config[key] = state.value;
            }
            return jsonResponse(config);
        }

        if (pathName === '/api/admin/archive-import' && request.method === 'POST') {
            try {
                const config = await request.json() as any;
                const targetUid = uid === 'anonymous' ? 'admin-seed' : uid;
                
                for (const key in config) {
                    if (USER_STATE_SERVER_DEFAULTS[key]) {
                        await Storage.saveState(targetUid, key, config[key], env);
                    }
                }
                return jsonResponse({ status: 'ok' });
            } catch (e: any) {
                return jsonResponse({ error: e.message }, 500);
            }
        }

        if (pathName === '/api/admin/wipe' && request.method === 'POST') {
            await Storage.resetUser(uid, env);
            return jsonResponse({ status: 'ok' });
        }

        return new Response('Not Found', { status: 404 });
    }
};
