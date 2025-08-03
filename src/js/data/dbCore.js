// @filepath: src/js/data/dbCore.js

// Refactored JS: concise, modern, functional, same output.

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 17; // FIX: Incrementing the version to ensure a new migration runs.

let _dbInstance = null;
let _dbInitPromise = null;

// FIX: A consistent and declarative schema definition.
// Store names are now simplified and match the rest of the application's logic.
const OBJECT_STORES_SCHEMA = [{
    name: 'feedItems',
    keyPath: 'guid',
    options: {
        unique: true
    }
}, {
    name: 'starred', // FIX: Renamed from 'starredItems'
    keyPath: 'guid'
}, {
    name: 'hidden', // FIX: Renamed from 'hiddenItems'
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
    options: {
        autoIncrement: true
    }
}];

/**
 * Initializes and returns a singleton database instance using idb.
 * This is the sole public function for accessing the database.
 * @returns {Promise<IDBPDatabase>} The IndexedDB database instance.
 */
export async function getDb() {
    if (_dbInstance) {
        return _dbInstance;
    }
    if (_dbInitPromise) {
        return _dbInitPromise;
    }

    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion) {
            console.log(`[DB] Upgrading database from version ${oldVersion} to ${DB_VERSION}`);

            // Migration logic to fix schema naming
            if (oldVersion < 16) {
                if (db.objectStoreNames.contains('starredItems')) {
                    db.deleteObjectStore('starredItems');
                }
                if (db.objectStoreNames.contains('hiddenItems')) {
                    db.deleteObjectStore('hiddenItems');
                }
            }
            if (oldVersion < 14) {
                 if (db.objectStoreNames.contains('currentDeckGuids')) {
                    db.deleteObjectStore('currentDeckGuids');
                }
                if (db.objectStoreNames.contains('shuffledOutGuids')) {
                    db.deleteObjectStore('shuffledOutGuids');
                }
            }

            // Create or update all stores based on the new schema
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (!db.objectStoreNames.contains(schema.name)) {
                    db.createObjectStore(schema.name, {
                        keyPath: schema.keyPath,
                        ...schema.options
                    });
                    console.log(`[DB] Created new store: ${schema.name}`);
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
