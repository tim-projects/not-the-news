import { Env, USER_STATE_SERVER_DEFAULTS } from '../config.ts';
import { processFeeds, FeedItem } from '../rss.ts'; // Reusing rss.ts as low-level
import { jsonResponse, errorResponse } from '../utils/response.ts';

export async function generateDemoDeck(env: Env): Promise<void> {
    console.log('[Cron] Generating Demo Deck...');
    
    // 1. Gather Feed URLs from Defaults
    const defaults = USER_STATE_SERVER_DEFAULTS['rssFeeds'].default;
    let feedUrls: string[] = [];
    
    const extract = (obj: any) => {
        for (const k in obj) {
            if (Array.isArray(obj[k])) {
                obj[k].forEach((item: any) => {
                    const url = (typeof item === 'string') ? item : (item && item.url) ? item.url : '';
                    if (url) feedUrls.push(url);
                });
            } else if (typeof obj[k] === 'object') {
                extract(obj[k]);
            }
        }
    };
    extract(defaults);

    // 2. Fetch Feeds
    // Empty blacklist for demo
    const items = await processFeeds(feedUrls, []);
    
    // 3. Score Items (Simple recency + image boost for demo)
    const scoredItems = items.map(item => {
        let score = item.timestamp;
        if (item.image) score += 1000 * 60 * 60 * 12; // Boost items with images by 12 hours
        return { ...item, score };
    });

    // 4. Select Top 10
    scoredItems.sort((a, b) => b.score - a.score);
    const demoDeck = scoredItems.slice(0, 10);

    console.log(`[Cron] Generated ${demoDeck.length} items for demo deck.`);

    // 5. Store in R2
    if (!env.DEMO_BUCKET) {
        console.error('[Cron] DEMO_BUCKET not configured!');
        return;
    }

    const payload = JSON.stringify({
        updatedAt: new Date().toISOString(),
        items: demoDeck
    });

    await env.DEMO_BUCKET.put(env.DEMO_JSON_PATH || 'demo-deck.json', payload, {
        httpMetadata: { contentType: 'application/json' }
    });
}

export async function fetchDemoDeck(env: Env): Promise<Response> {
    if (!env.DEMO_BUCKET) return errorResponse('Demo bucket not configured', 500);
    
    const object = await env.DEMO_BUCKET.get(env.DEMO_JSON_PATH || 'demo-deck.json');
    if (object === null) {
        return errorResponse('Demo deck not found', 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Access-Control-Allow-Origin', '*');
    // Cache heavily on the edge, revalidate somewhat frequently
    headers.set('Cache-Control', 'public, max-age=300, stale-while-revalidate=600'); 

    return new Response(object.body, {
        headers
    });
}
