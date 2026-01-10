import { Env } from './config.ts';
import { handleTimeRequest, handleLoginRequest } from './handlers/api.ts';
import { handleFeedRefresh, handleFeedList, handleFeedLookup, handleFeedKeys } from './handlers/feed.ts';
import { handleUserProfile, handleAdminRequest } from './handlers/user.ts';
import { fetchDemoDeck } from './services/demoDeck.ts';
import { errorResponse, jsonResponse } from './utils/response.ts';
import * as jose from 'jose';

// Helper for auth (duplicated from original index.ts for now, or could move to middleware)
async function verifyFirebaseToken(token: string, projectId: string): Promise<jose.JWTPayload> {
    const JWKS = jose.createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
    const { payload } = await jose.jwtVerify(token, JWKS, {
        issuer: `https://securetoken.google.com/${projectId}`,
        audience: projectId,
    });
    return payload;
}

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PATCH, DELETE',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, if-none-match',
                'Access-Control-Max-Age': '86400',
            }
        });
    }

    const url = new URL(request.url);
    const pathName = url.pathname;

    // --- Public Routes ---
    if (pathName === '/api/demo-deck.json') {
        return fetchDemoDeck(env);
    }

    if (pathName === '/api/time') {
        return handleTimeRequest();
    }

    if (pathName === '/api/login') {
        return handleLoginRequest();
    }

    // --- Authenticated Routes ---
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
            return errorResponse('Unauthorized: Invalid Token', 401);
        }
    } else {
        return errorResponse('Unauthorized: No Token Provided', 401);
    }

    // --- Feed Routes ---
    if (pathName === '/api/refresh') return handleFeedRefresh(request, uid, env);
    if (pathName === '/api/list') return handleFeedList(request, uid, env);
    if (pathName === '/api/lookup') return handleFeedLookup(request, env);
    if (pathName === '/api/keys') return handleFeedKeys(request, uid, env); // Renamed from feed-guids

    // --- User Profile Routes ---
    if (pathName.startsWith('/api/profile') || pathName.startsWith('/api/user-state')) {
        return handleUserProfile(request, uid, env);
    }

    // --- Admin Routes ---
    if (pathName.startsWith('/api/admin/')) {
        return handleAdminRequest(request, uid, env);
    }

    // --- Backward Compatibility Aliases ---
    if (pathName === '/api/feed-sync') return handleFeedRefresh(request, uid, env);
    if (pathName === '/api/feed-guids') return handleFeedKeys(request, uid, env);
    if (pathName === '/api/feed-items') return handleFeedList(request, uid, env);

    return errorResponse('Not Found', 404);
}
