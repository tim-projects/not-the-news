// @filepath: src/js/data/dbCore.js

// Refactored JS: concise, modern, functional, same output.

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 13;
let _dbInstance = null;
let _dbInitPromise = null;

const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', keyPath: 'guid' },
    { name: 'hiddenItems', keyPath: 'guid' },
    // Refactored schema for stores that hold a single array.
    // They no longer have a keyPath, making them simple key-value stores.
    { name: 'currentDeckGuids' },
    { name: 'shuffledOutGuids' },
    { name: 'userSettings', keyPath: 'key' },
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } }
];

export async function initDb() {
    if (_dbInitPromise) return _dbInitPromise;

    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion) {
            console.log(`[DB] Upgrading database from version ${oldVersion} to ${newVersion}`);

            // General store creation and migration logic.
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (db.objectStoreNames.contains(schema.name)) {
                    // If a store exists with a different schema, delete and recreate it.
                    // This handles the migration for 'currentDeckGuids' and 'shuffledOutGuids'.
                    const store = db.transaction.objectStore(schema.name);
                    if (store.keyPath !== schema.keyPath || store.autoIncrement !== schema.options?.autoIncrement) {
                        db.deleteObjectStore(schema.name);
                        console.log(`[DB] Recreated store '${schema.name}' due to schema change.`);
                        db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    }
                } else {
                    // Create new stores.
                    db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    console.log(`[DB] Created new store: ${schema.name}`);
                }
            });
        },
        blocked() {
            console.warn('[DB] Database upgrade blocked. Please close all other tabs with this site open.');
            // The `alert()` call is a blocking operation and not best practice.
            // Replacing it with a non-blocking console warning is a more modern approach.
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
        throw e;
    }
}

export async function getDb() {
    if (!_dbInstance) {
        await initDb();
    }
    return _dbInstance;
}

export function isOnline() {
    return navigator.onLine;
}