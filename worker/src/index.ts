import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, PendingOperation } from '../../src/types/app';
import { processFeeds, FeedItem } from './rss';
import fs from 'node:fs';
import path from 'node:path';
import * as jose from 'jose';

// Minimal types for the worker
interface Env {
    APP_PASSWORD?: string;
    FIREBASE_PROJECT_ID?: string;
}

const DATA_DIR = fs.existsSync('/data') ? '/data' : '/tmp';
const USER_STATE_ROOT = path.join(DATA_DIR, 'user_state');

class Storage {
    static memCache: Record<string, any> = {};

    static ensureDirs(uid: string) {
        const userDir = path.join(USER_STATE_ROOT, uid);
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
            if (!fs.existsSync(USER_STATE_ROOT)) {
                fs.mkdirSync(USER_STATE_ROOT, { recursive: true });
            }
            if (!fs.existsSync(userDir)) {
                fs.mkdirSync(userDir, { recursive: true });
            }
        } catch (e: any) {
            console.error(`[Worker] Directory creation failed. Error: ${e.message}`);
        }
    }

    static getUserStatePath(uid: string, key: string): string {
        return path.join(USER_STATE_ROOT, uid, `${key}.json`);
    }

    static loadState(uid: string, key: string): { value: any, lastModified: string | null } {
        const cacheKey = `${uid}:${key}`;
        // Check memory cache first
        if (this.memCache[cacheKey]) {
            return this.memCache[cacheKey];
        }

        const filePath = this.getUserStatePath(uid, key);
        
        if (!fs.existsSync(filePath)) {
            const def = USER_STATE_SERVER_DEFAULTS[key];
            return { value: def ? def.default : null, lastModified: null };
        }
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(content);
            this.memCache[cacheKey] = parsed; // Populate cache
            return parsed;
        } catch (e) {
            console.error(`[Worker] Error loading state for ${key}:`, e);
            return { value: null, lastModified: null };
        }
    }

    static saveState(uid: string, key: string, value: any): string {
        this.ensureDirs(uid);
        const now = new Date().toISOString();
        const data = { value, lastModified: now };
        
        // Update memory cache
        const cacheKey = `${uid}:${key}`;
        this.memCache[cacheKey] = data;

        const filePath = this.getUserStatePath(uid, key);
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e: any) {
            console.error(`[Worker] Failed to write to ${filePath}: ${e.message}`);
        }
        return now;
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

// In-memory cache for feed items (Global for now, but feeds could be user-specific later)
let cachedFeedItems: FeedItem[] = [];
let lastSyncTime: string | null = null;

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
    'rssFeeds': { 'type': 'nested_object', 'default': {} },
    'keywordBlacklist': { 'type': 'array', 'default': [] },
    'customCss': { 'type': 'simple', 'default': '' },
    'shadowsEnabled': { 'type': 'simple', 'default': true },
    'curvesEnabled': { 'type': 'simple', 'default': true },
    'flickToSelectEnabled': { 'type': 'simple', 'default': true },
    'itemButtonMode': { 'type': 'simple', 'default': 'play' },
    'showSearchBar': { 'type': 'simple', 'default': false },
    'searchQuery': { 'type': 'simple', 'default': '' },
};

async function handleLogin(request: Request, env: Env): Promise<Response> {
    try {
        const data: any = await request.json();
        const submittedPw = data.password;
        const appPassword = env.APP_PASSWORD;

        if (!appPassword) {
            console.error('[Worker] APP_PASSWORD not found');
            return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
        }

        if (submittedPw !== appPassword) {
            return new Response(JSON.stringify({ error: 'Invalid password' }), { status: 401 });
        }

        const authToken = crypto.randomUUID();
        const response = new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
        
        response.headers.append('Set-Cookie', `auth=${authToken}; Max-Age=${90*24*60*60}; HttpOnly; Secure; SameSite=Strict; Path=/`);
        return response;
    } catch (e: any) {
        return new Response(JSON.stringify({ error: 'Internal server error' }), { status: 500 });
    }
}

async function syncFeeds(uid: string, env: Env): Promise<Response> {
    const { value: feedsConfig } = Storage.loadState(uid, 'rssFeeds');
    const { value: blacklist } = Storage.loadState(uid, 'keywordBlacklist');
    
    // Extract URLs from nested or flat config
    const feedUrls: string[] = [];
    if (Array.isArray(feedsConfig)) {
        feedUrls.push(...feedsConfig.filter(f => typeof f === 'string'));
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
        return new Response(JSON.stringify({ status: 'skipped', reason: 'No feed URLs configured' }));
    }

    try {
        const items = await processFeeds(feedUrls, blacklist || []);
        
        // Merge with existing global cache to avoid losing items other users might need
        // (This is a bit simplistic, but works for now)
        const existingGuids = new Set(cachedFeedItems.map(i => i.guid));
        const newItems = items.filter(i => !existingGuids.has(i.guid));
        cachedFeedItems.push(...newItems);
        
        lastSyncTime = new Date().toISOString();
        // Save cached items to disk
        const cachePath = path.join(DATA_DIR, 'feed_cache.json');
        try {
            fs.writeFileSync(cachePath, JSON.stringify({ items: cachedFeedItems, lastSyncTime }));
        } catch (e: any) {
            console.error(`[Worker] Failed to write feed cache to ${cachePath}: ${e.message}`);
        }
        
        return new Response(JSON.stringify({ status: 'ok', count: items.length }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        // Hydrate cache if empty
        if (cachedFeedItems.length === 0) {
            const cachePath = path.join(DATA_DIR, 'feed_cache.json');
            if (fs.existsSync(cachePath)) {
                try {
                    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
                    cachedFeedItems = cache.items;
                    lastSyncTime = cache.lastSyncTime;
                } catch (e) {
                    console.error('[Worker] Cache hydration failed:', e);
                }
            }
        }

        const url = new URL(request.url);
        const pathName = url.pathname;

        // AUTHENTICATION LOGIC
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
        } else if (pathName.startsWith('/api/') && pathName !== '/api/time' && pathName !== '/api/login') {
            // For now, allow transition but log it
            console.warn(`[Worker] Unauthenticated request to ${pathName}`);
            // In a strict multi-user app, we would return 401 here.
            // return new Response('Unauthorized', { status: 401 });
            
            // Temporary: map unauthenticated users to a "legacy" UID or just block them?
            // The user wants multi-user, so let's enforce it for API calls.
            if (pathName !== '/api/login') {
                 return new Response('Unauthorized: No Token Provided', { status: 401 });
            }
        }

        if (pathName === '/api/login' && request.method === 'POST') {
            // Legacy login - we can keep it for a while or remove it.
            // Let's keep it but it won't be used by the new frontend.
            return new Response(JSON.stringify({ error: 'Use Firebase Auth' }), { status: 410 });
        }

        if (pathName === '/api/time') {
            return new Response(JSON.stringify({ time: new Date().toISOString() }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName === '/api/feed-sync' && request.method === 'POST') {
            return syncFeeds(uid, env);
        }

        if (pathName === '/api/feed-guids') {
            // Filter guids based on user's feeds
            const { value: feedsConfig } = Storage.loadState(uid, 'rssFeeds');
            // For now, just return all guids to avoid complexity, but in the future
            // we should only return items belonging to the user's feeds.
            return new Response(JSON.stringify({
                guids: cachedFeedItems.map(i => i.guid),
                serverTime: lastSyncTime || new Date().toISOString()
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName === '/api/feed-items') {
            let wantedGuids: string[] = [];
            if (request.method === 'POST') {
                const data: any = await request.json();
                wantedGuids = data.guids || [];
            } else {
                const guidsParam = url.searchParams.get('guids');
                wantedGuids = guidsParam ? guidsParam.split(',') : [];
            }

            const results = wantedGuids.length > 0 
                ? cachedFeedItems.filter(i => wantedGuids.includes(i.guid))
                : cachedFeedItems;

            return new Response(JSON.stringify(results), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName.startsWith('/api/user-state/')) {
            const key = pathName.split('/').pop();
            if (key) {
                const state = Storage.loadState(uid, key);
                if (state.value === null && !USER_STATE_SERVER_DEFAULTS[key]) {
                    return new Response('Not Found', { status: 404 });
                }
                return new Response(JSON.stringify(state), {
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        if (pathName === '/api/user-state' && request.method === 'POST') {
            const operations: any[] = await request.json();
            const results = [];
            for (const op of operations) {
                if (op.type === 'simpleUpdate') {
                    const lastModified = Storage.saveState(uid, op.key, op.value);
                    results.push({ id: op.id, status: 'success', lastModified });
                } else if (op.type === 'readDelta' || op.type === 'starDelta') {
                    const key = op.type === 'readDelta' ? 'read' : 'starred';
                    const { value: current } = Storage.loadState(uid, key);
                    const arr = Array.isArray(current) ? current : [];
                    const filtered = arr.filter((i: any) => i.guid !== op.guid);
                    if (op.action === 'add') {
                        filtered.push({ guid: op.guid, timestamp: new Date().toISOString() });
                    }
                    const lastModified = Storage.saveState(uid, key, filtered);
                    results.push({ id: op.id, status: 'success', lastModified });
                }
            }
            return new Response(JSON.stringify({ status: 'ok', results, serverTime: new Date().toISOString() }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName === '/api/admin/config-backup') {
            const config: Record<string, any> = {};
            for (const key in USER_STATE_SERVER_DEFAULTS) {
                const state = Storage.loadState(uid, key);
                if (state.value !== null) config[key] = state.value;
            }
            return new Response(JSON.stringify(config), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName === '/api/admin/config-restore' && request.method === 'POST') {
            const config = await request.json();
            for (const key in config) {
                if (USER_STATE_SERVER_DEFAULTS[key]) {
                    Storage.saveState(uid, key, config[key]);
                }
            }
            return new Response(JSON.stringify({ status: 'ok' }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (pathName === '/api/admin/reset-app' && request.method === 'POST') {
            const userDir = path.join(USER_STATE_ROOT, uid);
            if (fs.existsSync(userDir)) {
                const files = fs.readdirSync(userDir);
                for (const file of files) {
                    fs.unlinkSync(path.join(userDir, file));
                }
            }
            // Clear memCache for this user
            for (const cacheKey in Storage.memCache) {
                if (cacheKey.startsWith(`${uid}:`)) {
                    delete Storage.memCache[cacheKey];
                }
            }
            return new Response(JSON.stringify({ status: 'ok' }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not Found', { status: 404 });
    },
};
