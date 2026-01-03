import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, PendingOperation } from '../../src/types/app';
import { processFeeds, FeedItem } from './rss';
import * as jose from 'jose';

// Minimal types for the worker
interface Env {
    APP_PASSWORD?: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
    ASSETS: { fetch: typeof fetch };
}

/**
 * Helper to get a Google OAuth2 Access Token for Firestore
 */
async function getGoogleAccessToken(env: Env): Promise<string> {
    const email = env.FIREBASE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = env.FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY;

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
        if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured in worker environment.");

        const token = await getGoogleAccessToken(env);
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/state/${key}`;

        console.log(`[Firestore] GET ${url}`);
        try {
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
        } catch (e: any) {
            console.error(`[Firestore] Fatal Load Error for ${key}:`, e);
            throw e;
        }
    }

    static async saveState(uid: string, key: string, value: any, env: Env): Promise<string> {
        const projectId = env.FIREBASE_PROJECT_ID;
        if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured in worker environment.");

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
        const keys = Object.keys(USER_STATE_SERVER_DEFAULTS);
        const projectId = env.FIREBASE_PROJECT_ID;
        if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured in worker environment.");

        for (const key of keys) {
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

// Global cache for feeds
let cachedFeedItems: FeedItem[] = [];
let lastSyncTime: string | null = null;

const syncCooldowns = new Map<string, number>();
const violationCounts = new Map<string, number>();
const BASE_COOLDOWN_MS = 30000;
const MAX_FEEDS_PER_USER = 25;
const MAX_PAYLOAD_SIZE = 128 * 1024;

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
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, if-none-match',
            ...headers
        }
    });
}

async function syncFeeds(uid: string, env: Env): Promise<Response> {
    const { value: feedsConfig } = await Storage.loadState(uid, 'rssFeeds', env);
    const { value: blacklist } = await Storage.loadState(uid, 'keywordBlacklist', env);
    
    let feedUrls: string[] = [];

    const normalizeAndValidateUrl = (str: string): string | null => {
        let candidate = str.trim();
        if (!candidate || candidate.startsWith('#')) return null;
        if (!candidate.includes('://') && candidate.includes('.')) {
            candidate = `https://${candidate}`;
        }
        try {
            const url = new URL(candidate);
            return (url.protocol === 'http:' || url.protocol === 'https:') ? candidate : null;
        } catch {
            return null;
        }
    };

    if (Array.isArray(feedsConfig)) {
        feedUrls = feedsConfig.map(f => typeof f === 'string' ? normalizeAndValidateUrl(f) : null).filter((f): f is string => f !== null);
    } else if (feedsConfig && typeof feedsConfig === 'object') {
        const extract = (obj: any) => {
            for (const k in obj) {
                if (Array.isArray(obj[k])) {
                    obj[k].forEach((item: any) => {
                        let raw = (typeof item === 'string') ? item : (item && item.url) ? item.url : '';
                        const normalized = normalizeAndValidateUrl(raw);
                        if (normalized) feedUrls.push(normalized);
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

    const throttledUrls = feedUrls.slice(0, MAX_FEEDS_PER_USER);

    try {
        const items = await processFeeds(throttledUrls, blacklist || []);
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
        let normalizedUrl = targetUrl.trim();
        if (!normalizedUrl || normalizedUrl.startsWith('#')) return jsonResponse({ error: 'Invalid URL' }, 400);
        if (!normalizedUrl.includes('://') && normalizedUrl.includes('.')) normalizedUrl = `https://${normalizedUrl}`;
        
        const url = new URL(normalizedUrl);
        if (!['http:', 'https:'].includes(url.protocol)) return jsonResponse({ error: 'Invalid protocol' }, 400);

        const hostname = url.hostname.toLowerCase();
        if (['localhost', '127.0.0.1', '0.0.0.0'].includes(hostname) || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
            return jsonResponse({ error: 'Restricted address' }, 403);
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const response = await fetch(url.href, { 
            signal: controller.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NTN-Discovery/1.0)' }
        });
        clearTimeout(timeout);

        if (!response.ok) return jsonResponse({ error: 'Site unreachable' }, 404);
        const text = await response.text();
        if (text.length > 1024 * 1024) return jsonResponse({ error: 'Page too large' }, 413);

        const feeds: string[] = [];
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
        try {
            const url = new URL(request.url);
            const pathName = url.pathname;

            // --- STATIC ASSETS PASSTHROUGH ---
            // If it's not an API request, let the assets handler take it.
            if (!pathName.startsWith('/api/')) {
                if (env.ASSETS) {
                    return env.ASSETS.fetch(request);
                } else {
                    console.error('[Worker] ASSETS binding is missing.');
                    return new Response('Assets Not Available', { status: 500 });
                }
            }

            if (request.method === 'POST') {
                const contentLength = request.headers.get('Content-Length');
                if (contentLength && parseInt(contentLength) > MAX_PAYLOAD_SIZE) {
                    return jsonResponse({ error: 'Payload too large' }, 413);
                }
            }

            if (request.method === 'OPTIONS') {
                return jsonResponse({ status: 'ok' });
            }

            let uid = 'anonymous';
            const authHeader = request.headers.get('Authorization');
            
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
            } else if (pathName !== '/api/time' && pathName !== '/api/refresh' && pathName !== '/api/login') {
                 return new Response('Unauthorized: No Token Provided', { status: 401 });
            }

            if (pathName === '/api/login') {
                return jsonResponse({ error: 'Use Firebase Auth' }, 410);
            }

            if (pathName === '/api/time') {
                const now = new Date();
                return jsonResponse({ time: now.toISOString(), timestamp: now.getTime() });
            }

            if (pathName === '/api/refresh' && request.method === 'POST') {
                const now = Date.now();
                const lastSync = syncCooldowns.get(uid) || 0;
                const violations = violationCounts.get(uid) || 0;
                const requiredCooldown = BASE_COOLDOWN_MS * Math.pow(2, Math.min(violations, 10));
                
                if (now - lastSync < requiredCooldown) {
                    violationCounts.set(uid, violations + 1);
                    const retrySeconds = Math.ceil((requiredCooldown - (now - lastSync)) / 1000);
                    return jsonResponse({ error: 'Sync too frequent', retryAfter: retrySeconds, penaltyLevel: violations + 1 }, 429);
                }
                if (now - lastSync > (requiredCooldown * 2)) violationCounts.delete(uid);
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
                if (wantedGuids.length > 50) return jsonResponse({ error: 'Too many GUIDs requested' }, 400);
                const results = wantedGuids.length > 0 ? cachedFeedItems.filter(i => wantedGuids.includes(i.guid)) : cachedFeedItems;
                return jsonResponse(results);
            }

            if (pathName.startsWith('/api/profile/')) {
                const key = pathName.split('/').pop();
                if (key) {
                    const state = await Storage.loadState(uid, key, env);
                    if (state.value === null && !USER_STATE_SERVER_DEFAULTS[key]) return new Response('Not Found', { status: 404 });
                    return jsonResponse(state);
                }
            }

            if (pathName === '/api/profile' && request.method === 'POST') {
                const operations: any[] = await request.json();
                if (operations.length > 25) return jsonResponse({ error: 'Too many operations in batch' }, 400);
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
                        if (op.action === 'add') filtered.push({ guid: op.guid, timestamp: new Date().toISOString() });
                        const lastModified = await Storage.saveState(uid, key, filtered, env);
                        results.push({ id: op.id, status: 'success', lastModified });
                    }
                }
                return jsonResponse({ status: 'ok', results, serverTime: new Date().toISOString() });
            }

            if (pathName === '/api/admin/wipe' && request.method === 'POST') {
                await Storage.resetUser(uid, env);
                return jsonResponse({ status: 'ok' });
            }

            return new Response('Not Found', { status: 404 });
        } catch (globalError: any) {
            console.error('[Worker] Global Error:', globalError);
            // Return safe error message without circular references
            return jsonResponse({
                error: globalError.message || 'Internal Server Error',
                type: globalError.name
            }, 500);
        }
    }
};