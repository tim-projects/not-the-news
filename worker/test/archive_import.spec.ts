import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';

// Mock RSS module to avoid 'rss-parser' load issues in test env
vi.mock('../src/rss', () => ({
    processFeeds: vi.fn(),
    FeedItem: class {}
}));

// Mock dependencies
vi.mock('jose', async () => {
    return {
        createRemoteJWKSet: vi.fn(),
        jwtVerify: vi.fn().mockImplementation(async (token) => {
            return { payload: { sub: 'test_user' } };
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

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe('Archive Import Robustness', () => {
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
        fetchMock.mockImplementation(async (url, options) => {
            if (url === 'https://oauth2.googleapis.com/token') {
                return {
                    ok: true,
                    json: async () => ({ access_token: 'mock_token' })
                };
            }
            
            // Simulate Firestore calls
            if (url.includes('firestore.googleapis.com')) {
                // FAIL on specific key to test robustness
                if (url.includes('/state/bad_key')) {
                    throw new Error('Simulated Network Error');
                }
                
                // Success for others
                return {
                    ok: true,
                    json: async () => ({ updateTime: new Date().toISOString() })
                };
            }
            return { ok: true };
        });
    });

    it('should continue importing other keys if one fails', async () => {
        // We need to inject 'bad_key' into USER_STATE_SERVER_DEFAULTS or use an existing key but mock the failure
        // logic based on the key name. The worker code iterates over `config` keys.
        // It ONLY processes keys that are in USER_STATE_SERVER_DEFAULTS.
        // So we need to fail a valid key. Let's say 'theme' works, but 'fontSize' fails. 
        
        // RE-MOCK Fetch for this specific test case
        fetchMock.mockImplementation(async (url, options) => {
            if (url === 'https://oauth2.googleapis.com/token') {
                return { ok: true, json: async () => ({ access_token: 'mock_token' }) };
            }

            if (url.includes('/state/theme')) {
                return { ok: true, json: async () => ({ updateTime: '2026-01-01' }) };
            }
            
            if (url.includes('/state/fontSize')) {
                // Simulate a hard failure (exception) for this key
                throw new Error('Firestore unavailable for fontSize');
            }

            return { ok: true, json: async () => ({ updateTime: '2026-01-01' }) };
        });

        const req = new Request('http://localhost/api/admin/archive-import', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer token' },
            body: JSON.stringify({
                theme: 'dark',        // Should succeed
                fontSize: 120,        // Should fail
                syncEnabled: true     // Should succeed
            })
        });

        const res = await worker.fetch(req, env, ctx);
        const data: any = await res.json();

        expect(data.status).toBe('ok');
        expect(data.imported).toBe(2); // theme + syncEnabled
        expect(data.failed).toBe(1);   // fontSize
    });
});
