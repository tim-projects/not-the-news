import { openDB } from 'idb';

type IDBPDatabase = any; // Temporarily use 'any' for the IDBPDatabase type to resolve import error

const DB_NAME = 'not-the-news-db';
// Increment the version to trigger the necessary schema upgrade.
const DB_VERSION = 29;

let _dbInstance: IDBPDatabase | null = null;
let _dbInitPromise: Promise<IDBPDatabase> | null = null;

/**
 * A consistent and declarative schema definition.
 * All data object stores now use a numeric, auto-incrementing primary key ('id') for
 * storage efficiency, and a 'guid' index for business logic lookups.
 */
interface IndexSchema {
    name: string;
    keyPath: string;
    options?: IDBIndexParameters;
}

interface ObjectStoreSchema {
    name: string;
    keyPath: string;
    options?: IDBObjectStoreParameters;
    indexes?: IndexSchema[];
}

export const OBJECT_STORES_SCHEMA: ObjectStoreSchema[] = [{
    name: 'feedItems',
    keyPath: 'id',
    options: { autoIncrement: true },
    indexes: [{ name: 'guid', keyPath: 'guid', options: { unique: true } }]
}, {
    name: 'starred',
    keyPath: 'id',
    options: { autoIncrement: true },
    indexes: [{ name: 'guid', keyPath: 'guid', options: { unique: true } }]
}, {
    name: 'read',
    keyPath: 'id',
    options: { autoIncrement: true },
    indexes: [{ name: 'guid', keyPath: 'guid', options: { unique: true } }]
}, {
    name: 'currentDeckGuids', // NOTE: This store now holds full objects, not just GUIDs.
    keyPath: 'id',
    options: { autoIncrement: true },
    indexes: [{ name: 'guid', keyPath: 'guid', options: { unique: true } }]
}, {
    name: 'shuffledOutGuids', // NOTE: This store now holds full objects, not just GUIDs.
    keyPath: 'id',
    options: { autoIncrement: true },
    indexes: [{ name: 'guid', keyPath: 'guid', options: { unique: true } }]
}, {
    name: 'userSettings', // Standard key-value store.
    keyPath: 'key'
}, {
    name: 'pendingOperations', // Queue for offline operations.
    keyPath: 'id',
    options: { autoIncrement: true }
}];

/**
 * Initializes and returns a singleton database instance using idb.
 */
async function getDb() {
    if (_dbInstance) {
        return _dbInstance;
    }
    if (_dbInitPromise) {
        return _dbInitPromise;
    }

    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db: IDBPDatabase, oldVersion: number) {
            console.log(`[DB] Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
            const existingStores = new Set(db.objectStoreNames);

            OBJECT_STORES_SCHEMA.forEach(schema => {
                let store;
                // The most reliable way to handle a keyPath change is to recreate the store.
                if (existingStores.has(schema.name)) {
                    db.deleteObjectStore(schema.name);
                }
                store = db.createObjectStore(schema.name, {
                    keyPath: schema.keyPath,
                    ...(schema.options || {})
                });
                console.log(`[DB] Created/Recreated store: ${schema.name}`);

                // Create indexes for efficient lookups (e.g., by guid).
                if (schema.indexes) {
                    schema.indexes.forEach(index => {
                        store.createIndex(index.name, index.keyPath, index.options || {});
                        console.log(`[DB] Created index '${index.name}' on store '${schema.name}'`);
                    });
                }
            });
        },
        blocked() {
            console.warn('[DB] Database upgrade blocked. Please close all other tabs with this site open.');
        },
        blocking() {
            console.warn('[DB] Database blocking other tabs.');
        }
    });

    try {
        _dbInstance = await _dbInitPromise;
        console.log(`[DB] Opened '${DB_NAME}', version ${DB_VERSION}`);
        return _dbInstance;
    } catch (e) {
        console.error(`[DB] Failed to open database '${DB_NAME}':`, e);
        _dbInstance = null;
        _dbInitPromise = null;
        throw e;
    }
}

/**
 * Closes the database connection.
 */
export async function closeDb(): Promise<void> {
    if (_dbInstance) {
        _dbInstance.close();
        _dbInstance = null;
        _dbInitPromise = null;
        console.log('[DB] Database connection closed.');
    }
}

/**
 * Ensures a single, ready database instance is available before a callback is executed.
 */
export async function withDb<T>(callback: (db: IDBPDatabase) => T): Promise<T> {
    let dbInstance = await getDb();
    return callback(dbInstance);
}

export { getDb as initDb };