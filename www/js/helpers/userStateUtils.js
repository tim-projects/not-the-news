// www/js/helpers/userStateUtils.js

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation,
    processPendingOperations,
    isOnline,
    loadArrayState, // --- FIX: Re-added loadArrayState ---
    saveArrayState  // --- FIX: Re-added saveArrayState ---
} from '../data/database.js'; // Adjusted path to database.js


/**
 * Toggles the starred status of an item and manages synchronization.
 * @param {object} app - The main application state object (e.g., Vue instance).
 * @param {string} guid - The unique identifier of the item.
 */
export const USER_STATE_DEFS = {
// Array-based states stored in their own dedicated object stores.
// Their *timestamps* will be stored as simple key-value pairs in 'userSettings'
// using their key name (e.g., 'starred' will have a timestamp in 'userSettings').
starred: { store: 'starredItems', type: 'array', default: [] },
hidden: { store: 'hiddenItems', type: 'array', default: [] },
currentDeckGuids: { store: 'currentDeckGuids', type: 'array', default: [] },

// Simple value states stored in the 'userSettings' object store
filterMode: { store: 'userSettings', type: 'simple', default: 'all' },
syncEnabled: { store: 'userSettings', type: 'simple', default: true },
imagesEnabled: { store: 'userSettings', type: 'simple', default: true },
rssFeeds: { store: 'userSettings', type: 'simple', default: [] },
keywordBlacklist: { store: 'userSettings', type: 'simple', default: [] },
shuffleCount: { store: 'userSettings', type: 'simple', default: 0 },
lastShuffleResetDate: { store: 'userSettings', type: 'simple', default: null },
openUrlsInNewTabEnabled: { store: 'userSettings', type: 'simple', default: true },
// A specific key to store the global latest timestamp from server sync
lastStateSync: { store: 'userSettings', type: 'simple', default: null },
lastViewedItemId: { store: 'userSettings', type: 'simple', default: null },
lastViewedItemOffset: { store: 'userSettings', type: 'simple', default: 0 },
};
export async function toggleStar(app, db, guid) {
    const tx = db.transaction('starredItems', 'readwrite');
    const store = tx.objectStore('starredItems');

    const starredAt = new Date().toISOString();
    let action;

    try {
        const existingItem = await store.get(guid);

        if (existingItem) {
            // Item is currently starred, so unstar it
            await store.delete(guid);
            action = "remove";
            // Update app's in-memory starred list
            app.starred = app.starred.filter(item => item.id !== guid);
        } else {
            // Item is not starred, so star it
            await store.put({
                id: guid,
                starredAt
            });
            action = "add";
            // Update app's in-memory starred list
            app.starred.push({
                id: guid,
                starredAt
            });
        }

        await tx.done; // Ensure the transaction completes

        // Trigger UI update if necessary
        if (typeof app.updateCounts === 'function') app.updateCounts();

        // Add the operation to the persistent pending operations buffer
        const deltaObject = {
            id: guid,
            action,
            starredAt
        };
        await addPendingOperation(db, {
            type: 'starDelta',
            data: deltaObject
        });

        // Attempt immediate background sync if online
        if (isOnline()) {
            try {
                await processPendingOperations(db);
            } catch (syncErr) {
                console.error("Failed to immediately sync star change, operation remains buffered:", syncErr);
                // The operation is already buffered, so no re-addition needed here.
            }
        }
    } catch (error) {
        console.error("Error in toggleStar:", error);
    }
}

/**
 * Toggles the hidden status of an item and manages synchronization.
 * @param {object} app - The main application state object.
 * @param {string} guid - The unique identifier of the item.
 */
export async function toggleHidden(app, guid) {
    const tx = db.transaction('hiddenItems', 'readwrite');
    const store = tx.objectStore('hiddenItems');

    const hiddenAt = new Date().toISOString();
    let action;

    try {
        const existingItem = await store.get(guid);

        if (existingItem) {
            // Item is currently hidden, so unhide it
            await store.delete(guid);
            action = "remove";
            // Update app's in-memory hidden list
            app.hidden = app.hidden.filter(item => item.id !== guid);
        } else {
            // Item is not hidden, so hide it
            await store.put({
                id: guid,
                hiddenAt
            });
            action = "add";
            // Update app's in-memory hidden list
            app.hidden.push({
                id: guid,
                hiddenAt
            });
        }

        await tx.done; // Ensure the transaction completes

        // Trigger UI update if necessary
        if (typeof app.updateCounts === 'function') app.updateCounts();

        // Add the operation to the persistent pending operations buffer
        const deltaObject = {
            id: guid,
            action,
            hiddenAt
        };
        await addPendingOperation(db, {
            type: 'hiddenDelta',
            data: deltaObject
        });

        // Attempt immediate background sync if online
        if (isOnline()) {
            try {
                await processPendingOperations(db);
            } catch (syncErr) {
                console.error("Failed to immediately sync hidden change, operation remains buffered:", syncErr);
                // The operation is already buffered, so no re-addition needed here.
            }
        }
    } catch (error) {
        console.error("Error in toggleHidden:", error);
    }
}

/**
 * Prunes stale hidden items from the hiddenItems store.
 * Items are considered stale if they are not in the current feedItems and are older than 30 days.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @param {Array<object>} feedItems - The array of current feed items (expected to have 'id' property).
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(db, feedItems, currentTS) {
    // --- FIX: Use loadArrayState instead of getHiddenItems ---
    const { value: hiddenItems } = await loadArrayState(db, 'hidden');

    // Basic validation
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0 || !feedItems.every(e => e && typeof e.id === 'string')) return hiddenItems;

    const validFeedIds = new Set(feedItems.map(e => e.id.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const itemsToDelete = hiddenItems.filter(i => {
        const normalizedId = String(i.id).trim().toLowerCase();
        // Keep if the item is still present in the current feed
        if (validFeedIds.has(normalizedId)) return false;
        // Check if the item is older than 30 days
        const hiddenAtTS = new Date(i.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) >= THIRTY_DAYS_MS;
    });

    if (itemsToDelete.length > 0) {
        const tx = db.transaction('hiddenItems', 'readwrite');
        const store = tx.objectStore('hiddenItems');
        try {
            for (const item of itemsToDelete) {
                await store.delete(item.id); // Direct delete from IndexedDB
            }
            await tx.done; // Wait for all deletes to complete
            // After successful deletion, filter the in-memory list to return the pruned list
            return hiddenItems.filter(item => !itemsToDelete.includes(item));
        } catch (error) {
            console.error("Error pruning stale hidden items:", error);
            // If deletion fails, return the original list to avoid potential data inconsistency in app state
            return hiddenItems;
        }
    }
    return hiddenItems; // No items to prune, return original list
}

/**
 * Loads the current deck of GUIDs.
 * This function now relies on `loadArrayState` which operates on the `currentDeckGuids` store.
 * @param {IDBDatabase} db - The IndexedDB database instance. --- FIX: Added db parameter ---
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck(db) { // --- FIX: Added db parameter ---
    // --- FIX: Use loadArrayState instead of getCurrentDeckGuids ---
    const { value: guids } = await loadArrayState(db, 'currentDeckGuids');
    return Array.isArray(guids) ? guids : [];
}

/**
 * Saves the current deck of GUIDs.
 * This function now uses a direct IndexedDB transaction for the 'currentDeckGuids' store
 * and also buffers the operation for server sync.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @param {Array<string>} guids - The array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(db, guids) {
    // --- FIX: Use saveArrayState which handles the transaction and store operations ---
    await saveArrayState(db, 'currentDeckGuids', guids);

    console.log(`[saveCurrentDeck] Saved ${guids.length} GUIDs to currentDeckGuids store.`);

    // Add the operation to the pending operations buffer for server sync
    await addPendingOperation(db, {
        type: 'simpleUpdate', // This type indicates it uses the generic /user-state POST
        key: 'currentDeckGuids',
        value: guids // Send the entire array to the server
    });

    // Attempt immediate background sync if online
    if (isOnline()) {
        try {
            await processPendingOperations(db);
        } catch (syncErr) {
            console.error("Failed to immediately sync currentDeckGuids change, operation remains buffered:", syncErr);
        }
    }
}

/**
 * Loads the shuffle state, including shuffle count and last reset date.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @returns {Promise<{shuffleCount: number, lastShuffleResetDate: Date|null}>} The shuffle state.
 */
export async function loadShuffleState(db) {
    // loadSimpleState returns an object { value, lastModified }
    const { value: count } = await loadSimpleState(db, 'shuffleCount');
    const { value: dateStr } = await loadSimpleState(db, 'lastShuffleResetDate');

    let shuffleCount = typeof count === 'number' ? count : 2; // Default if not found or invalid
    let lastResetDate = null;
    if (dateStr) {
        try {
            lastResetDate = new Date(dateStr);
        } catch (err) {
            console.warn("Invalid lastShuffleResetDate:", dateStr, err);
        }
    }
    return {
        shuffleCount: shuffleCount,
        lastShuffleResetDate: lastResetDate
    };
}

/**
 * Saves the shuffle state, including shuffle count and last reset date.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @param {number} count - The current shuffle count.
 * @param {Date} resetDate - The date of the last shuffle reset.
 */
export async function saveShuffleState(db, count, resetDate) {
    await saveSimpleState(db, 'shuffleCount', count);
    await saveSimpleState(db, 'lastShuffleResetDate', resetDate.toISOString());

    // Add these simple updates to the pending operations buffer
    await addPendingOperation(db, { type: 'simpleUpdate', key: 'shuffleCount', value: count });
    await addPendingOperation(db, { type: 'simpleUpdate', key: 'lastShuffleResetDate', value: resetDate.toISOString() });

    if (isOnline()) {
        try {
            await processPendingOperations(db);
        } catch (syncErr) {
            console.error("Failed to immediately sync shuffle state change, operations remain buffered:", syncErr);
        }
    }
}

/**
 * Sets the current filter mode for the application.
 * @param {object} app - The main application state object.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @param {string} mode - The filter mode to set (e.g., 'unread', 'starred').
 */
export async function setFilterMode(app, db, mode) {
    app.filterMode = mode;
    await saveSimpleState(db, 'filterMode', mode);

    // Add this simple update to the pending operations buffer
    await addPendingOperation(db, { type: 'simpleUpdate', key: 'filterMode', value: mode });

    if (isOnline()) {
        try {
            await processPendingOperations(db);
        } catch (syncErr) {
            console.error("Failed to immediately sync filter mode change, operation remains buffered:", syncErr);
        }
    }
}

/**
 * Loads the current filter mode from storage.
 * @param {IDBDatabase} db - The IndexedDB database instance.
 * @returns {Promise<string>} The current filter mode.
 */
export async function loadFilterMode(db) {
    const { value: mode } = await loadSimpleState(db, 'filterMode');
    return mode || 'unread'; // Provide a default if not found
}