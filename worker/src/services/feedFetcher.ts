import { Env, USER_STATE_SERVER_DEFAULTS } from '../config.ts';
import { processFeeds, FeedItem } from '../rss.ts';
import { Storage } from './storage.ts';
import { jsonResponse } from '../utils/response.ts';

// In-memory cache for feed items (User ID -> Cache)
// This is a simple global cache for the worker instance
const userCaches = new Map<string, { items: FeedItem[], lastSync: string }>();

export async function syncFeeds(uid: string, env: Env, since: number = 0): Promise<Response> {
    const userFeedsState = await Storage.loadState(uid, 'rssFeeds', env);
    let feedUrls: string[] = [];

    // 1. Extract URLs from state or defaults
    const feedsConfig = userFeedsState.value || USER_STATE_SERVER_DEFAULTS['rssFeeds'].default;
    
    // Recursive extraction helper
    const extract = (obj: any) => {
        for (const k in obj) {
            if (Array.isArray(obj[k])) {
                // Handle array of strings or objects
                obj[k].forEach((item: any) => {
                    const url = (typeof item === 'string') ? item : (item && item.url) ? item.url : '';
                    if (url) feedUrls.push(url);
                });
            } else if (typeof obj[k] === 'object') {
                extract(obj[k]);
            }
        }
    };
    extract(feedsConfig);

    // 2. Fetch Blacklist
    const blacklistState = await Storage.loadState(uid, 'keywordBlacklist', env);
    const blacklist = Array.isArray(blacklistState.value) ? blacklistState.value : [];

    console.log(`[Sync] Syncing ${feedUrls.length} feeds for user ${uid}...`);

    // 3. Process Feeds
    const allItems = await processFeeds(feedUrls, blacklist);
    
    // 4. Update Cache
    const serverTime = new Date().toISOString();
    userCaches.set(uid, { items: allItems, lastSync: serverTime });

    // 5. Delta logic
    const deltaItems = allItems.filter(item => item.timestamp > since);
    
    // 6. Return minimal payload
    // Only return minimal info for delta sync to save bandwidth
    const minimalItems = deltaItems.map(item => ({
        guid: item.guid,
        timestamp: item.timestamp,
        // We might want to send more if the client needs it immediately, 
        // but typically client fetches full content by ID later.
        // For now, let's send minimal.
    }));

    return jsonResponse({
        status: 'ok',
        serverTime,
        items: minimalItems
    });
}

export async function getFeedItems(uid: string, env: Env, guids: string[]): Promise<Response> {
    if (guids.length > 100) return jsonResponse({ error: 'Too many GUIDs requested' }, 400);
    
    let userCache = userCaches.get(uid);
    
    // If cache is missing or doesn't have all wanted items, try one sync
    const hasAllItems = userCache && guids.every(g => userCache!.items.some(i => i.guid === g));
    
    if (!hasAllItems && guids.length > 0) {
        console.log(`[List] Items missing from cache for ${uid}, triggering internal sync...`);
        await syncFeeds(uid, env, 0);
        userCache = userCaches.get(uid);
    }

    const currentItems = userCache ? userCache.items : [];
    const results = guids.length > 0 ? currentItems.filter(i => guids.includes(i.guid)) : currentItems;
    
    return jsonResponse(results);
}

export async function discoverFeeds(targetUrl: string): Promise<Response> {
    try {
        // Validate URL
        let urlObj: URL;
        try {
            urlObj = new URL(targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`);
        } catch {
            return jsonResponse({ error: 'Invalid URL' }, 400);
        }

        // Prevent SSRF on private ranges (basic check)
        const hostname = urlObj.hostname;
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('192.168.')) {
             return jsonResponse({ error: 'Invalid URL target' }, 400);
        }

        console.log(`[Discovery] Looking up feeds for: ${urlObj.href}`);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        
        const response = await fetch(urlObj.href, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; RSS-Discovery/1.0)'
            }
        });
        clearTimeout(timeout);

        if (!response.ok) return jsonResponse({ error: 'Failed to fetch target' }, 502);

        const html = await response.text();
        const feedUrls: string[] = [];
        
        // Regex for <link rel="alternate" type="application/rss+xml" href="...">
        const linkRegex = /<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
        const hrefRegex = /href=["']([^"']+)["']/i;
        
        const matches = html.match(linkRegex) || [];
        for (const tag of matches) {
            const hrefMatch = tag.match(hrefRegex);
            if (hrefMatch) {
                let feedUrl = hrefMatch[1];
                // Handle relative URLs
                if (!feedUrl.startsWith('http')) {
                    feedUrl = new URL(feedUrl, urlObj.href).href;
                }
                feedUrls.push(feedUrl);
            }
        }

        return jsonResponse({ feeds: feedUrls });

    } catch (e: any) {
        console.error('[Discovery] Error:', e);
        return jsonResponse({ error: e.message }, 500);
    }
}
