import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem, PendingOperation } from '../../src/types/app';
import { processFeeds, FeedItem } from './rss';

// Minimal types for the worker
interface Env {
    // Add bindings if needed, e.g., KV, D1
    APP_PASSWORD?: string;
}

// In-memory cache for the "offline" local implementation
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
            console.error('[Worker] APP_PASSWORD not found in environment');
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

async function getSingleUserState(key: string, env: Env): Promise<Response> {
    const defaultData = USER_STATE_SERVER_DEFAULTS[key];
    if (!defaultData) {
        return new Response('Not Found', { status: 404 });
    }
    
    return new Response(JSON.stringify({
        value: defaultData.default,
        lastModified: new Date().toISOString()
    }), {
        headers: { 'Content-Type': 'application/json' }
    });
}

async function syncFeeds(env: Env): Promise<Response> {
    const feedUrls = [
        'https://news.ycombinator.com/rss',
        'https://www.wired.com/feed/rss'
    ];

    try {
        const items = await processFeeds(feedUrls);
        cachedFeedItems = items;
        lastSyncTime = new Date().toISOString();
        return new Response(JSON.stringify({ status: 'ok', count: items.length }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // Simple auth check middleware
        const authRequired = path.startsWith('/api/') && !path.startsWith('/api/login');
        if (authRequired) {
            const cookie = request.headers.get('Cookie');
            const authHeader = request.headers.get('Authorization');
            if (!cookie?.includes('auth=') && !authHeader) {
                return new Response('Unauthorized', { status: 401 });
            }
        }

        if (path === '/api/login' && request.method === 'POST') {
            return handleLogin(request, env);
        }

        if (path === '/api/time') {
            return new Response(JSON.stringify({ time: new Date().toISOString() }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (path === '/api/feed-sync' && request.method === 'POST') {
            return syncFeeds(env);
        }

        if (path === '/api/feed-guids') {
            return new Response(JSON.stringify({
                guids: cachedFeedItems.map(i => i.guid),
                serverTime: lastSyncTime || new Date().toISOString()
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (path === '/api/feed-items') {
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

        if (path.startsWith('/api/user-state/')) {
            const key = path.split('/').pop();
            if (key) return getSingleUserState(key, env);
        }

        if (path === '/api/user-state' && request.method === 'POST') {
            const ops: any[] = await request.json();
            const results = ops.map(op => ({
                id: op.id,
                status: 'success',
                lastModified: new Date().toISOString()
            }));
            return new Response(JSON.stringify({
                status: 'ok',
                serverTime: new Date().toISOString(),
                results
            }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Not Found', { status: 404 });
    },
};
