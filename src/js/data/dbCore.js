// @filepath: src/js/data/dbCore.js

// Refactored JS: concise, modern, functional, same output.

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 14; // Incrementing the version to handle schema changes

let _dbInstance = null;
let _dbInitPromise = null;

// A consistent and declarative schema definition.
// Use keyPath: null for stores without an explicit key.
const OBJECT_STORES_SCHEMA = [{
    name: 'feedItems',
    keyPath: 'guid',
    options: {
        unique: true
    }
}, {
    name: 'starredItems',
    keyPath: 'guid'
}, {
    name: 'hiddenItems',
    keyPath: 'guid'
}, {
    name: 'currentDeckGuids',
    keyPath: null
}, {
    name: 'shuffledOutGuids',
    keyPath: null
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

            // Migration logic for keyPath change in DB_VERSION 14
            // This is a robust way to handle schema changes by deleting and recreating the store.
            if (oldVersion < 14) {
                // The schema for these stores is changing from a keyPath to a simple key-value store.
                if (db.objectStoreNames.contains('currentDeckGuids')) {
                    db.deleteObjectStore('currentDeckGuids');
                }
                if (db.objectStoreNames.contains('shuffledOutGuids')) {
                    db.deleteObjectStore('shuffledOutGuids');
                }
            }

            // Create or update all stores based on the schema
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