import { Env, USER_STATE_SERVER_DEFAULTS } from '../config.ts';
import { Storage } from '../services/storage.ts';
import { jsonResponse, errorResponse } from '../utils/response.ts';

export async function handleUserProfile(request: Request, uid: string, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathName = url.pathname;
    
    // GET /api/profile/:key
    if (request.method === 'GET') {
        const key = pathName.split('/').pop();
        if (key) {
            const state = await Storage.loadState(uid, key, env);
            
            // Check for ETag match (If-None-Match) to return 304
            const ifNoneMatch = request.headers.get('If-None-Match');
            if (ifNoneMatch && state.lastModified && ifNoneMatch === state.lastModified) {
                return new Response(null, { status: 304 });
            }

            if (state.value === null && !USER_STATE_SERVER_DEFAULTS[key]) {
                return new Response('Not Found', { status: 404 });
            }

            // Handle Delta Sync
            const since = url.searchParams.get('since');
            if (since && Array.isArray(state.value)) {
                const sinceTime = new Date(since).getTime();
                if (!isNaN(sinceTime)) {
                    const timeField = key === 'read' ? 'readAt' : (key === 'starred' ? 'starredAt' : 'timestamp');
                    const filtered = state.value.filter((item: any) => {
                        const itemTime = new Date(item[timeField] || item.timestamp || 0).getTime();
                        return itemTime > sinceTime;
                    });
                    return jsonResponse({
                        value: filtered,
                        lastModified: state.lastModified,
                        partial: true
                    });
                }
            }

            return jsonResponse(state);
        }
    }

    // POST /api/profile (Batch Operations)
    if (request.method === 'POST') {
        try {
            const operations: any[] = await request.json();
            if (operations.length > 25) return jsonResponse({ error: 'Too many operations in batch' }, 400);
            
            const results = [];
            for (const op of operations) {
                if (op.type === 'simpleUpdate') {
                    const lastModified = await Storage.saveState(uid, op.key, op.value, env);
                    results.push({ id: op.id, status: 'success', lastModified });
                } else if (op.type === 'readDelta' || op.type === 'starDelta') {
                    const key = op.type === 'readDelta' ? 'read' : 'starred';
                    const timeField = op.type === 'readDelta' ? 'readAt' : 'starredAt';
                    const { value: current } = await Storage.loadState(uid, key, env);
                    const arr = Array.isArray(current) ? current : [];
                    
                    const filtered = arr.filter((i: any) => i.guid.toLowerCase() !== op.guid.toLowerCase());
                    if (op.action === 'add') {
                        const item: any = { guid: op.guid };
                        item[timeField] = op.timestamp || new Date().toISOString();
                        filtered.push(item);
                    }
                    const lastModified = await Storage.saveState(uid, key, filtered, env);
                    results.push({ id: op.id, status: 'success', lastModified });
                }
            }
            return jsonResponse({ status: 'ok', results, serverTime: new Date().toISOString() });
        } catch (e) {
            console.error('[Profile] Error processing batch:', e);
            return errorResponse('Invalid JSON or batch processing error', 400);
        }
    }

    return errorResponse('Method Not Allowed', 405);
}

export async function handleAdminRequest(request: Request, uid: string, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathName = url.pathname;

    if (pathName === '/api/admin/reset-app' && request.method === 'POST') {
        console.log(`[Admin] Resetting app for user ${uid}`);
        // 1. List all keys for user
        // KV doesn't support easy "delete by prefix" without listing first
        // In a real production system, this might be slow or hit limits.
        if (env.NTN_KV) {
            const prefix = `user:${uid}:`;
            let keys: any[] = [];
            let cursor: string | undefined = undefined;
            
            do {
                const list = await env.NTN_KV.list({ prefix, cursor });
                keys = keys.concat(list.keys);
                cursor = list.list_complete ? undefined : list.cursor;
            } while (cursor);

            // 2. Delete all keys
            await Promise.all(keys.map(k => env.NTN_KV!.delete(k.name)));
        }
        
        return jsonResponse({ status: 'ok', message: 'User data reset' });
    }

    if (pathName === '/api/admin/archive-export' && request.method === 'GET') {
        // Export all user state as a JSON object
        const exportData: Record<string, any> = {};
        const keysToExport = Object.keys(USER_STATE_SERVER_DEFAULTS).concat(['read', 'starred', 'theme', 'themeStyle', 'syncEnabled', 'imagesEnabled', 'itemButtonMode', 'openUrlsInNewTabEnabled', 'filterMode']); // Add other known keys
        
        for (const key of keysToExport) {
            const { value } = await Storage.loadState(uid, key, env);
            if (value !== null) {
                exportData[key] = value;
            }
        }
        return jsonResponse(exportData);
    }

    if (pathName === '/api/admin/archive-import' && request.method === 'POST') {
        try {
            const importData: any = await request.json();
            const results = [];
            // Basic validation: remove 'uid' from imported data if present to prevent cross-contamination
            if (importData.uid) delete importData.uid;

            for (const key in importData) {
                // Security: Only allow known keys or safe patterns
                if (key.length > 50 || key.includes(':')) continue; 
                
                const value = importData[key];
                await Storage.saveState(uid, key, value, env);
                results.push(key);
            }
            return jsonResponse({ status: 'ok', imported: results.length });
        } catch (e) {
            return errorResponse('Import failed', 400);
        }
    }

    return errorResponse('Not Found', 404);
}
