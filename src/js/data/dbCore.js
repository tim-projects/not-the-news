// @filepath: src/js/data/dbCore.js

// This file handles the core IndexedDB initialization and schema definition.
// It also provides the synchronized `withDb` helper function.

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 22; // FIX: Aggressively incrementing to force a new migration run.

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
    keyPath: 'guid'
}, {
    name: 'shuffledOutGuids',
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
 * This is the sole public function for accessing the database.
 * @returns {Promise<IDBPDatabase>} The IndexedDB database instance.
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
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (db.objectStoreNames.contains(schema.name)) {
                    db.deleteObjectStore(schema.name);
                    console.log(`[DB] Deleted old store: ${schema.name}`);
                }
                db.createObjectStore(schema.name, {
                    keyPath: schema.keyPath,
                    ...schema.options
                });
                console.log(`[DB] Created new store: ${schema.name}`);
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
 * This helper is the key to preventing the race condition.
 * @param {Function} callback The function to execute with the database instance.
 * @returns {Promise<any>} The result of the callback.
 */
export async function withDb(callback) {
    let dbInstance = await getDb();
    return callback(dbInstance);
}

// Re-export getDb for backward compatibility if needed
export { getDb as initDb };
