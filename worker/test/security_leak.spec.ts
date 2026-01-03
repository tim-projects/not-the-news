import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';

// --- Mock Dependencies ---

vi.mock('jose', async () => {
    return {
        createRemoteJWKSet: vi.fn(),
        jwtVerify: vi.fn().mockImplementation(async (token) => {
            if (token === 'token_user_a') return { payload: { sub: 'user_a' } };
            if (token === 'token_user_b') return { payload: { sub: 'user_b' } };
            throw new Error('Invalid token');
        }),
        importPKCS8: vi.fn(),
        SignJWT: vi.fn().mockImplementation(() => ({
            setProtectedHeader: () => ({
                setIssuer: () => ({
                    setSubject: () => ({
                        setAudience: () => ({
                            setExpirationTime: () => ({
                                setIssuedAt: () => ({
                                    sign: () => 'mock_google_token'
                                })
                            })
                        })
                    })
                })
            })
        }))
    };
});

// Mock RSS processing to return predictable data
vi.mock('../src/rss', () => ({
    processFeeds: vi.fn().mockImplementation(async (urls) => {
        return [{
            guid: 'guid_' + Math.random(),
            title: 'User Specific Item',
            link: 'http://secret.com',
            timestamp: Date.now()
        }];
    })
}));

// Mock fetch for Firestore calls
const fetchMock = vi.fn();
global.fetch = fetchMock;

// In-memory mock storage for Firestore to test profile isolation
const mockFirestoreData: Record<string, any> = {};

describe('Security Leak & Isolation Check', () => {
    const env: any = {
        FIREBASE_PROJECT_ID: 'test-project',
        FIREBASE_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
        FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----',
        ASSETS: { fetch: vi.fn() }
    };
    const ctx: any = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn()
    };

    beforeEach(() => {
        vi.clearAllMocks();
        
        // Reset mock storage
        for (const key in mockFirestoreData) delete mockFirestoreData[key];

        fetchMock.mockImplementation(async (url, options) => {
            // Google OAuth Token Endpoint
            if (url === 'https://oauth2.googleapis.com/token') {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'mock_access_token' })
                };
            }

            // Firestore Operations
            if (typeof url === 'string' && url.includes('firestore.googleapis.com')) {
                const parts = url.split('/');
                const userIndex = parts.indexOf('users');
                const uid = parts[userIndex + 1];
                const key = parts[parts.length - 1];
                const storageKey = `${uid}:${key}`;

                if (options?.method === 'PATCH') {
                    // SAVE
                    const body = JSON.parse(options.body);
                    mockFirestoreData[storageKey] = body.fields.value;
                    return {
                        ok: true,
                        json: async () => ({ updateTime: new Date().toISOString() })
                    };
                } else {
                    // LOAD
                    if (mockFirestoreData[storageKey]) {
                        return {
                            ok: true,
                            json: async () => ({ fields: { value: mockFirestoreData[storageKey] }, updateTime: new Date().toISOString() })
                        };
                    } else {
                        return {
                            status: 404,
                            ok: false,
                            text: async () => 'Not Found'
                        };
                    }
                }
            }
            
            return { ok: true, text: async () => 'ok' };
        });
    });

    it('ENDPOINT: /api/refresh & /api/keys - should isolate feed items between users', async () => {
        // 1. User A syncs (populating the cache)
        const reqA = new Request('http://localhost/api/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer token_user_a' }
        });
        await worker.fetch(reqA, env, ctx);

        // 2. User B requests keys
        const reqB = new Request('http://localhost/api/keys', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token_user_b' }
        });
        const resB = await worker.fetch(reqB, env, ctx);
        const dataB: any = await resB.json();

        // EXPECTATION: User B should NOT see User A's generated items
        // Currently, they share `cachedFeedItems` global, so this will likely FAIL before fix.
        expect(dataB.guids).toHaveLength(0);
    });

    it('ENDPOINT: /api/list - should isolate full feed items', async () => {
        // 1. User A syncs
        const reqA = new Request('http://localhost/api/refresh', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer token_user_a' }
        });
        await worker.fetch(reqA, env, ctx);

        // 2. User B lists all items
        const reqB = new Request('http://localhost/api/list', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token_user_b' }
        });
        const resB = await worker.fetch(reqB, env, ctx);
        const dataB: any = await resB.json();

        expect(dataB).toHaveLength(0);
    });

    it('ENDPOINT: /api/profile - should isolate user state', async () => {
        // 1. User A saves a specific theme
        const reqASave = new Request('http://localhost/api/profile', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer token_user_a' },
            body: JSON.stringify([
                {
                    id: '1',
                    type: 'simpleUpdate',
                    key: 'theme',
                    value: 'user_a_theme'
                }
            ])
        });
        await worker.fetch(reqASave, env, ctx);

        // 2. User B reads their theme
        const reqBRead = new Request('http://localhost/api/profile/theme', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token_user_b' }
        });
        const resB = await worker.fetch(reqBRead, env, ctx);
        const dataB: any = await resB.json();

        // EXPECTATION: User B gets default 'dark' or null, NOT 'user_a_theme'
        expect(dataB.value).not.toBe('user_a_theme');
        expect(dataB.value).toBe('dark'); // Default
    });

    it('ENDPOINT: /api/admin/archive-import - should ignore/strip "uid" from payload', async () => {
        // User A tries to import a config that claims to be for "user_b"
        // This simulates a malicious backup file
        const reqImport = new Request('http://localhost/api/admin/archive-import', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer token_user_a' },
            body: JSON.stringify({
                uid: 'user_b', // Malicious field
                theme: 'hacked_theme'
            })
        });

        await worker.fetch(reqImport, env, ctx);

        // CHECK 1: User A's theme should be updated
        // Because the 'uid' field in body is ignored, it uses the token's uid (user_a)
        const reqARead = new Request('http://localhost/api/profile/theme', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token_user_a' }
        });
        const resA = await worker.fetch(reqARead, env, ctx);
        const dataA: any = await resA.json();
        expect(dataA.value).toBe('hacked_theme');

        // CHECK 2: User B's theme should be UNTOUCHED
        const reqBRead = new Request('http://localhost/api/profile/theme', {
            method: 'GET',
            headers: { 'Authorization': 'Bearer token_user_b' }
        });
        const resB = await worker.fetch(reqBRead, env, ctx);
        const dataB: any = await resB.json();
        // Should be default or empty, NOT 'hacked_theme'
        expect(dataB.value).not.toBe('hacked_theme');
    });
});
