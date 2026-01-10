export interface Env {
    APP_PASSWORD?: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
    FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
    ASSETS: { fetch: typeof fetch };
    DEMO_BUCKET?: R2Bucket;
    DEMO_JSON_PATH?: string;
    // Legacy KV support if needed, though project seems to use Firestore mostly now
    // Adding it for Storage class compatibility if it was used there
    NTN_KV?: KVNamespace; 
}

export const USER_STATE_SERVER_DEFAULTS: Record<string, any> = {
    rssFeeds: {
        store: 'userSettings',
        type: 'simple',
        default: {
            'News': {
                'World': [
                    { title: 'BBC News', url: 'http://feeds.bbci.co.uk/news/rss.xml' },
                    { title: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' }
                ],
                'Tech': [
                    { title: 'Hacker News', url: 'https://news.ycombinator.com/rss' },
                    { title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' }
                ]
            }
        }
    },
    keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
    // Add other defaults as needed
};
