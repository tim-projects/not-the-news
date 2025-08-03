// @filepath: src/js/data/dbCore.js

// Refactored JS: concise, modern, functional, same output.

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 19; // FIX: Incrementing the version to force a new migration run.

let _dbInstance = null;
let _dbInitPromise = null;

// A consistent and declarative schema definition.
const OBJECT_STORES_SCHEMA = [{
    name: 'feedItems',
    keyPath: 'guid',
    options: {
        unique: true
    }
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

            // Migration logic: First, delete any stores with old or incorrect names.
            if (db.objectStoreNames.contains('starredItems')) {
                db.deleteObjectStore('starredItems');
            }
            if (db.objectStoreNames.contains('hiddenItems')) {
                db.deleteObjectStore('hiddenItems');
            }
            if (db.objectStoreNames.contains('currentDeckGuids') && oldVersion < 14) {
                db.deleteObjectStore('currentDeckGuids');
            }
            if (db.objectStoreNames.contains('shuffledOutGuids') && oldVersion < 14) {
                db.deleteObjectStore('shuffledOutGuids');
            }

            // Then, ensure all stores from the current schema exist.
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
