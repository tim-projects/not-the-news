import { withDb } from './dbCore.ts';

// Locally declare types that are not exported from their modules
type IDBPDatabase = any;

// Define interfaces for USER_STATE_DEFS and related types
export interface UserStateDef {
    store: string;
    type: 'array' | 'simple';
    localOnly: boolean;
    default: any;
}

export interface UserStateDefs {
    [key: string]: UserStateDef;
}

// --- User State Definitions ---
export const USER_STATE_DEFS: UserStateDefs = {
    starred: { store: 'starred', type: 'array', localOnly: false, default: [] },
    read: { store: 'read', type: 'array', localOnly: false, default: [] },
    currentDeckGuids: { store: 'currentDeckGuids', type: 'array', localOnly: false, default: [] },
    shuffledOutGuids: { store: 'shuffledOutGuids', type: 'array', localOnly: false, default: [] },
    lastStateSync: { store: 'userSettings', type: 'simple', localOnly: false, default: 0 },
    lastFeedSync: { store: 'userSettings', type: 'simple', localOnly: false, default: 0 },
    openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    imagesEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    itemButtonMode: { store: 'userSettings', type: 'simple', localOnly: false, default: 'play' },
    syncEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    theme: { store: 'userSettings', type: 'simple', localOnly: false, default: 'dark' },
    themeStyle: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalDark' },
    themeStyleLight: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalLight' },
    themeStyleDark: { store: 'userSettings', type: 'simple', localOnly: false, default: 'originalDark' },
    customCss: { store: 'userSettings', type: 'simple', localOnly: false, default: '' },
    fontSize: { store: 'userSettings', type: 'simple', localOnly: true, default: 100 },
    feedWidth: { store: 'userSettings', type: 'simple', localOnly: true, default: 50 },
    animationSpeed: { store: 'userSettings', type: 'simple', localOnly: false, default: 100 },
    feedLastModified: { store: 'userSettings', type: 'simple', localOnly: true, default: 0 },
    rssFeeds: { store: 'userSettings', type: 'simple', localOnly: false, default: {} },
    keywordBlacklist: { store: 'userSettings', type: 'simple', localOnly: false, default: [] },
    shuffleCount: { store: 'userSettings', type: 'simple', localOnly: false, default: 2 },
    lastShuffleResetDate: { store: 'userSettings', type: 'simple', localOnly: false, default: null },
    shadowsEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    curvesEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: true },
    flickToSelectEnabled: { store: 'userSettings', type: 'simple', localOnly: false, default: false },
    pregeneratedOnlineDeck: { store: 'userSettings', type: 'simple', localOnly: true, default: null },
    pregeneratedOfflineDeck: { store: 'userSettings', type: 'simple', localOnly: true, default: null }
};

export interface SimpleStateValue {
    value: any;
    lastModified: string | null;
}

/**
 * Loads a simple key-value state from the specified store.
 * This is a basic loader that does NOT depend on sync logic.
 */
export async function loadSimpleState(key: string, storeName: string = 'userSettings'): Promise<SimpleStateValue> {
    return withDb(async (db: IDBPDatabase) => {
        try {
            const record = await db.get(storeName, key);
            return {
                value: record ? record.value : USER_STATE_DEFS[key]?.default || null,
                lastModified: record?.lastModified || null
            };
        } catch (e) {
            console.error(`Failed to load simple state for key '${key}':`, e);
            return { value: USER_STATE_DEFS[key]?.default || null, lastModified: null };
        }
    });
}

export interface ArrayStateValue {
    value: any[];
}

const getTimestampKey = (storeName: string): string => {
    switch (storeName) {
        case 'starred': return 'starredAt';
        case 'read': return 'readAt';
        case 'currentDeckGuids': return 'addedAt';
        case 'shuffledOutGuids': return 'shuffledAt';
        default: return 'updatedAt';
    }
};

/**
 * Loads all items from a store, performing data migration if necessary.
 * This is a basic loader that does NOT depend on sync logic.
 */
export async function loadArrayState(storeName: string): Promise<ArrayStateValue> {
    console.log(`ENTERING loadArrayState for ${storeName}`);
    return withDb(async (db: IDBPDatabase) => {
        try {
            const allItems: any[] = await db.getAll(storeName);
            const needsMigration = allItems.length > 0 && (typeof allItems[0] === 'string' || allItems[0].id === undefined);

            if (needsMigration) {
                console.log(`[DB] Migration required for '${storeName}'.`);
                const timestampKey = getTimestampKey(storeName);
                const now = new Date().toISOString();
                // Deduplicate the array before migration to prevent unique constraint errors.
                const uniqueItems = new Map<string, any>();
                allItems.forEach(item => {
                    const guid = typeof item === 'string' ? item : item.guid;
                    if (guid && !uniqueItems.has(guid)) {
                        uniqueItems.set(guid, item);
                    }
                });

                const deduplicatedItems = Array.from(uniqueItems.values());

                const migratedItems = deduplicatedItems.map(item => ({
                    guid: typeof item === 'string' ? item : item.guid,
                    [timestampKey]: now
                }));

                const tx = db.transaction(storeName, 'readwrite');
                await tx.store.clear();
                for (const item of migratedItems) await tx.store.put(item);
                await tx.done;

                console.log(`[DB] Migration complete for '${storeName}'.`);
                return { value: await db.getAll(storeName) };
            }
            return { value: allItems || USER_STATE_DEFS[storeName]?.default || [] };
        } catch (e) {
            console.error(`Failed to load array state from store '${storeName}':`, e);
            return { value: USER_STATE_DEFS[storeName]?.default || [] };
        }
    });
}
