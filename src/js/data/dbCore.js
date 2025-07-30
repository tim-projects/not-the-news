// www/js/data/dbCore.js

import { openDB } from '../libs/idb.js';

const DB_NAME = 'not-the-news-db';
// IMPORTANT: Increment DB_VERSION to trigger the upgrade logic.
// If your current version is 12, make it 13.
const DB_VERSION = 13; // <-- ***CHANGED: INCREMENT THIS VERSION NUMBER***
let _dbInstance = null;
let _dbInitPromise = null;

const OBJECT_STORES_SCHEMA = [
    // feedItems: Correctly uses 'guid' as keyPath, as it's provided by the API and unique.
    { name: 'feedItems', keyPath: 'guid', options: { unique: true } },
    // starredItems: Correctly uses 'guid' as keyPath, assuming these refer to feed items.
    { name: 'starredItems', keyPath: 'guid' },
    // hiddenItems: Correctly uses 'guid' as keyPath, assuming these refer to feed items.
    { name: 'hiddenItems', keyPath: 'guid' },
    // currentDeckGuids: Correctly uses 'guid' as keyPath, assuming these are feed item GUIDs.
    { name: 'currentDeckGuids', keyPath: 'guid' },
    // shuffledOutGuids: Correctly uses 'guid' as keyPath, assuming these are feed item GUIDs.
    { name: 'shuffledOutGuids', keyPath: 'guid' },
    // userSettings: Correctly uses 'key' as keyPath (e.g., 'lastViewedItemId', 'theme').
    { name: 'userSettings', keyPath: 'key' },
    // pendingOperations: This is the primary change.
    // It should use 'id' as keyPath with autoIncrement: true,
    // as these are client-generated operations that need a unique local identifier.
    // The 'guid' property on an operation (like 'guid: 1' in your example) should be removed
    // when creating the operation object, as it's not the primary key here and can be misleading.
    { name: 'pendingOperations', keyPath: 'id', options: { autoIncrement: true } } // <-- ***CHANGED***
];

export async function initDb() {
    if (_dbInitPromise) return _dbInitPromise;

    _dbInitPromise = openDB(DB_NAME, DB_VERSION, {
        upgrade(db, oldVersion, newVersion, transaction) { // Added 'transaction' parameter
            console.log(`[DB] Upgrading database from version ${oldVersion} to ${newVersion}`);

            // General store creation loop for new stores or schema changes
            OBJECT_STORES_SCHEMA.forEach(schema => {
                if (!db.objectStoreNames.contains(schema.name)) {
                    db.createObjectStore(schema.name, { keyPath: schema.keyPath, ...schema.options });
                    console.log(`[DB] Created store: ${schema.name}`);
                }
            });

            // Specific migration logic for 'pendingOperations'
            // This handles existing users who might have an old 'pendingOperations' store
            // with 'guid' as keyPath, or no 'id' for autoIncrement.
            if (oldVersion < 13) { // This `if` block triggers if an older version is detected
                if (db.objectStoreNames.contains('pendingOperations')) {
                    // Option A: If it exists, delete the old one and create the new one.
                    // This will lose any buffered pending operations for existing users on upgrade.
                    // For pending operations, this is often an acceptable trade-off for simplicity,
                    // as they represent transient sync actions.
                    db.deleteObjectStore('pendingOperations');
                    console.log('[DB] Deleted old pendingOperations store.');
                }
                // Now create the new (or re-create if it was deleted) pendingOperations store
                db.createObjectStore('pendingOperations', { keyPath: 'id', autoIncrement: true });
                console.log('[DB] Re-created pendingOperations store with keyPath: "id", autoIncrement: true.');

                // If you had data in 'pendingOperations' that you absolutely MUST preserve
                // and migrate from 'guid' to 'id', the logic here would be much more complex.
                // It would involve:
                // 1. Creating a new temporary store.
                // 2. Opening a transaction on the *old* store.
                // 3. Iterating through all items in the old store.
                // 4. For each item, manually assigning an 'id' (e.g., a new UUID if autoIncrement
                //    is not desired, or preparing it for autoIncrement by removing old `id` / `guid`).
                // 5. Adding/putting the item into the new store.
                // 6. Deleting the old store and renaming the new one (or just creating the new one
                //    if it's named the same and data is put into it).
                // Given the nature of 'pendingOperations' as a transient queue,
                // deleting and recreating is often the simplest and most pragmatic approach.
            }

            // Example of a past migration (oldVersion < 7) - keep this if it's relevant,
            // but ensure it doesn't conflict with your new overall schema definition.
            // If the `OBJECT_STORES_SCHEMA` is comprehensive, this specific oldVersion check
            // might become redundant.
            // if (oldVersion < 7) {
            //     // This was already covered by the main loop for version 13 upgrade
            //     // if it's part of OBJECT_STORES_SCHEMA.
            //     // Consider if this block is still needed or if the new schema definition handles it.
            //     if (!db.objectStoreNames.contains('pendingOperations')) {
            //         db.createObjectStore('pendingOperations', { keyPath: 'guid', autoIncrement: true });
            //         console.log('[DB] Created store: pendingOperations (legacy version < 7)');
            //     }
            // }
        },
        blocked() {
            console.warn('[DB] Database upgrade blocked. Please close all other tabs with this site open.');
            alert('Database update blocked. Please close all other tabs with this site open.');
        },
        blocking() {
            console.warn('[DB] Database blocking other tabs.');
        }
    });
    _dbInstance = await _dbInitPromise;
    console.log(`[DB] Opened '${DB_NAME}', version ${DB_VERSION}`);
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