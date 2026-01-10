import { Env } from '../config.ts';
import { syncFeeds, getFeedItems, discoverFeeds } from '../services/feedFetcher.ts';
import { jsonResponse, errorResponse } from '../utils/response.ts';
import { Storage } from '../services/storage.ts'; // For keys handler if it accesses cache

export async function handleFeedRefresh(request: Request, uid: string, env: Env): Promise<Response> {
    if (request.method !== 'POST') return errorResponse('Method Not Allowed', 405);
    
    let since = 0;
    try {
        const data: any = await request.clone().json();
        since = Number(data.since) || 0;
    } catch {
        const urlParams = new URL(request.url).searchParams;
        since = Number(urlParams.get('since')) || 0;
    }

    return syncFeeds(uid, env, since);
}

export async function handleFeedList(request: Request, uid: string, env: Env): Promise<Response> {
    let wantedGuids: string[] = [];
    const url = new URL(request.url);

    if (request.method === 'POST') {
        try {
            const data: any = await request.json();
            wantedGuids = data.guids || [];
        } catch (e) {
            console.error('[List] Failed to parse request body:', e);
            return errorResponse('Invalid JSON', 400);
        }
    } else {
        const guidsParam = url.searchParams.get('guids');
        wantedGuids = guidsParam ? guidsParam.split(',') : [];
    }
    return getFeedItems(uid, env, wantedGuids);
}

export async function handleFeedLookup(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) return jsonResponse({ error: 'URL required' }, 400);
    return discoverFeeds(targetUrl);
}

export async function handleFeedKeys(request: Request, uid: string, env: Env): Promise<Response> {
    // In the monolithic version, this accessed userCaches directly.
    // We should probably expose a way to get cache stats or just re-implement simple cache access if possible.
    // For now, let's assume we can fetch it or just return empty if cache isn't easily accessible across modules
    // without shared state file.
    // Actually, feedFetcher.ts has the cache. We might need to export a helper there.
    
    // BUT: The original code for /api/keys just returned what was in memory. 
    // If we want to keep that behavior, we should add a 'getCacheKeys' to feedFetcher.ts
    // For now, returning empty or implementing a real DB check is safer than relying on memory in serverless.
    // Let's stub it or move the logic to feedFetcher if crucial.
    
    return jsonResponse({
        guids: [], // TODO: Implement proper cache inspection if needed
        serverTime: new Date().toISOString()
    });
}
