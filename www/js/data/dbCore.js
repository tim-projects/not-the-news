// www/js/data/dbCore.js

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 12;
let _dbInstance = null;
let _dbInitPromise = null;

const OBJECT_STORES_SCHEMA = [
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    { name: 'starredItems', options: { keyPath: 'id' } },
    { name: 'hiddenItems', options: { keyPath: 'id' } },
    { name: 'currentDeckGuids', keyPath: 'id' },
    { name: 'shuffledOutGuids', keyPath: 'id' },
    { name: 'userSettings', keyPath: 'key' },
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } }
];

export async function initDb() {
    if (_dbInitPromise) return _dbInitPromise;

    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion) {
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (!db.objectStoreNames.contains(schema.name)) {
                    db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    console.log(`[DB] Created store: ${schema.name}`); // Added logging
                }
            });
            if (oldVersion < 7) {
                if (!db.objectStoreNames.contains('pendingOperations')) {
                    db.createObjectStore('pendingOperations', { keyPath: 'id', autoIncrement: true });
                    console.log('[DB] Created store: pendingOperations'); // Added logging
                }
            }
        },
        blocked() {
            console.warn('[DB] Database upgrade blocked.'); // Added logging
            alert('Database update blocked. Please close all other tabs with this site open.');
        },
        blocking() {
            console.warn('[DB] Database blocking other tabs.'); // Added logging
        }
    });
    _dbInstance = await _dbInitPromise;
    console.log(`[DB] Opened '${DB_NAME}', version ${DB_VERSION}`); // Added logging
    return _dbInstance;
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