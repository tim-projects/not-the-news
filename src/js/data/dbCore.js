// @filepath: src/js/data/dbCore.js

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
// FIX: Increment the version to trigger the necessary schema upgrade.
const DB_VERSION = 26;

let _dbInstance = null;
let _dbInitPromise = null;

// A consistent and declarative schema definition.
export const OBJECT_STORES_SCHEMA = [{
    name: 'feedItems',
    keyPath: 'guid',
    options: { unique: true }
}, {
    name: 'starred',
    keyPath: 'guid'
}, {
    name: 'hidden',
    keyPath: 'guid'
}, {
    name: 'currentDeckGuids',
    // FIX: Define keyPath as 'guid' to allow for direct lookups and deletions.
    keyPath: 'guid'
}, {
    name: 'shuffledOutGuids',
    // FIX: Define keyPath as 'guid' to allow for direct lookups and deletions.
    keyPath: 'guid'
}, {
    name: 'userSettings',
    keyPath: 'key'
}, {
    name: 'pendingOperations',
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
        upgrade(db, oldVersion) {
            console.log(`[DB] Upgrading database from version ${oldVersion} to ${DB_VERSION}`);
            const existingStores = new Set(db.objectStoreNames);

            OBJECT_STORES_SCHEMA.forEach(schema => {
                // More robust upgrade: only delete/recreate if it exists
                if (existingStores.has(schema.name)) {
                    db.deleteObjectStore(schema.name);
                }
                db.createObjectStore(schema.name, {
                    keyPath: schema.keyPath,
                    ...(schema.options || {})
                });
                console.log(`[DB] Created/Recreated store: ${schema.name}`);
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
 * Ensures a single, ready database instance is available before a callback is executed.
 */
export async function withDb(callback) {
    let dbInstance = await getDb();
    return callback(dbInstance);
}

export { getDb as initDb };