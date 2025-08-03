// @filepath: src/js/helpers/userStateUtils.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation,
    processPendingOperations,
    isOnline,
    loadArrayState,
    saveArrayState,
    getDb
} from '../data/database.js';

import { createStatusBarMessage } from '../ui/uiUpdaters.js';

/**
 * Gets a single user setting from the userSettings store.
 * @param {string} key The key of the setting to get.
 * @returns {Promise<any>} The value of the setting.
 */
export async function getUserSetting(key) {
    const db = await getDb();
    const tx = db.transaction('userSettings', 'readonly');
    const store = tx.objectStore('userSettings');
    const value = await store.get(key);
    await tx.done;
    return value;
}

/**
 * Sets a single user setting in the userSettings store.
 * @param {string} key The key of the setting to set.
 * @param {any} value The value to set for the key.
 * @returns {Promise<void>}
 */
export async function setUserSetting(key, value) {
    const db = await getDb();
    const tx = db.transaction('userSettings', 'readwrite');
    const store = tx.objectStore('userSettings');
    await store.put(value, key);
    await tx.done;
}

/**
 * Toggles the starred status of an item and manages synchronization.
 * @param {object} app - The main application state object (e.g., Vue instance).
 * @param {string} guid - The unique identifier of the item (this is an RSS item GUID).
 */
export async function toggleStar(app, guid) {
    const db = await getDb();
    const tx = db.transaction('starredItems', 'readwrite');
    const store = tx.objectStore('starredItems');

    const starredAt = new Date().toISOString();
    let action;

    try {
        const existingItem = await store.get(guid);

        if (existingItem) {
            await store.delete(guid);
            action = "remove";
            app.starred = app.starred.filter(item => item.guid !== guid);
        } else {
            await store.put({
                guid: guid,
                starredAt
            });
            action = "add";
            app.starred.push({
                guid: guid,
                starredAt
            });
        }

        await tx.done;

        if (typeof app.updateCounts === 'function') app.updateCounts();

        const deltaObject = {
            itemGuid: guid,
            action,
            starredAt
        };
        await addPendingOperation({
            type: 'starDelta',
            data: deltaObject
        });

        if (isOnline()) {
            try {
                await processPendingOperations();
            } catch (syncErr) {
                console.error("Failed to immediately sync star change, operation remains buffered:", syncErr);
            }
        }
    } catch (error) {
        console.error("Error in toggleStar:", error);
    }
}

/**
 * Toggles the hidden status of an item and manages synchronization.
 * @param {object} app - The main application state object.
 * @param {string} guid - The unique identifier of the item (this is an RSS item GUID).
 */
export async function toggleHidden(app, guid) {
    const db = await getDb();
    const tx = db.transaction('hiddenItems', 'readwrite');
    const store = tx.objectStore('hiddenItems');

    const existingIndex = app.hidden.findIndex(item => item.guid === guid);

    if (existingIndex > -1) {
        app.hidden.splice(existingIndex, 1);
        await store.delete(guid);
        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'remove', itemGuid: guid } });
        createStatusBarMessage('Item unhidden.', 'info');
    } else {
        const hiddenAt = new Date().toISOString();
        await store.put({
            guid: guid,
            hiddenAt
        });
        app.hidden.push({ guid: guid, hiddenAt: hiddenAt });

        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'add', itemGuid: guid, timestamp: hiddenAt } });
        createStatusBarMessage('Item hidden.', 'info');
    }

    app.updateCounts();
}

/**
 * Prunes stale hidden items from the hiddenItems store.
 * Items are considered stale if they are not in the current feedItems and are older than 30 days.
 * @param {Array<object>} feedItems - The array of current feed items (expected to have 'guid' property).
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(feedItems, currentTS) {
    const db = await getDb();
    const hiddenItemsFromStore = await db.transaction('hiddenItems', 'readonly').objectStore('hiddenItems').getAll();

    if (!Array.isArray(hiddenItemsFromStore)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0 || !feedItems.every(e => e && typeof e.guid === 'string')) return hiddenItemsFromStore;

    const validFeedGuids = new Set(feedItems.map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const itemsToDelete = hiddenItemsFromStore.filter(i => {
        const normalizedGuid = String(i.guid).trim().toLowerCase();
        if (validFeedGuids.has(normalizedGuid)) return false;
        const hiddenAtTS = new Date(i.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) >= THIRTY_DAYS_MS;
    });

    if (itemsToDelete.length > 0) {
        const tx = db.transaction('hiddenItems', 'readwrite');
        const store = tx.objectStore('hiddenItems');
        try {
            for (const item of itemsToDelete) {
                await store.delete(item.guid);
            }
            await tx.done;
            return hiddenItemsFromStore.filter(item => !itemsToDelete.includes(item));
        } catch (error) {
            console.error("Error pruning stale hidden items:", error);
            return hiddenItemsFromStore;
        }
    }
    return hiddenItemsFromStore;
}

/**
 * Loads the current deck of GUIDs.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    const { value: storedItems } = await loadArrayState('currentDeckGuids');
    
    console.log("[loadCurrentDeck] Raw stored items:", storedItems);
    
    if (Array.isArray(storedItems)) {
        // Check if items are already strings (new format) or objects (old format)
        if (storedItems.length > 0) {
            const firstItem = storedItems[0];
            
            if (typeof firstItem === 'string') {
                // New format: items are already GUID strings
                console.log("[loadCurrentDeck] Loading new format (direct strings)");
                return storedItems.filter(Boolean);
            } else if (firstItem && typeof firstItem === 'object' && firstItem.guid) {
                // Old format: items are objects with .guid property
                console.log("[loadCurrentDeck] Loading old format (objects with .guid)");
                return storedItems.map(item => item.guid).filter(Boolean);
            }
        }
        
        // Empty array or unknown format
        return [];
    }
    
    console.log("[loadCurrentDeck] No stored items found, returning empty array");
    return [];
}
/**
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store
 * and queues a corresponding sync operation.
 *
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    try {
        // 1. Validate input upfront.
        if (!Array.isArray(guids)) {
            console.error("[saveCurrentDeck] Invalid input: expected an array of GUIDs, got:", typeof guids, guids);
            return;
        }

        console.log("[saveCurrentDeck] Saving", guids.length, "GUIDs to store");

        const db = await getDb();
        const tx = db.transaction('currentDeckGuids', 'readwrite');
        const store = tx.objectStore('currentDeckGuids');

        await store.clear();

        let savedCount = 0;
        for (const guid of guids) {
            // 2. Ensure each GUID is a valid string before attempting to save.
            if (typeof guid === 'string' && guid.trim() !== '') {
                // FIXED: Save the GUID string directly, not wrapped in an object
                await store.put(guid); // ✅ CORRECT
                savedCount++;
            } else {
                console.warn("[saveCurrentDeck] Skipping invalid or empty GUID:", guid);
            }
        }

        await tx.done; // Wait for the transaction to complete successfully.

        console.log(`[saveCurrentDeck] Saved ${savedCount} GUIDs to currentDeckGuids store.`);

        // 3. Queue the sync operation. This will only run after a successful transaction.
        await addPendingOperation({
            type: 'simpleUpdate',
            key: 'currentDeckGuids',
            value: guids // Send the original array for server reconciliation
        });

        // 4. If online, attempt to process the buffered operation immediately.
        if (isOnline()) {
            await processPendingOperations();
        }

    } catch (e) {
        // 5. Catch any errors that occur during the transaction or sync attempt.
        console.error("[saveCurrentDeck] An error occurred:", e);
        throw e; // Re-throw to inform the caller that the operation failed.
    }
}
/**
 * Loads the shuffle state, including shuffle count, last reset date.
 * @returns {Promise<{shuffleCount: number, lastShuffleResetDate: Date|null}>} The shuffle state.
 */
export async function loadShuffleState() {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2,
        lastShuffleResetDate: lastShuffleResetDate ? new Date(lastShuffleResetDate) : null,
    };
}

/**
 * Saves the shuffle state, including shuffle count, last reset date.
 * @param {number} count - The current shuffle count.
 * @param {Date|null} resetDate - The date of the last shuffle reset.
 */
export async function saveShuffleState(count, resetDate) {
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate ? resetDate.toISOString() : null);

    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'shuffleCount',
        value: count
    });
    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'lastShuffleResetDate',
        value: resetDate ? resetDate.toISOString() : null
    });

    if (isOnline()) {
        try {
            await processPendingOperations();
        } catch (syncErr) {
            console.error("Failed to immediately sync shuffle state change, operations remain buffered:", syncErr);
        }
    }
}

/**
 * Sets the current filter mode for the application.
 * @param {object} app - The main application state object.
 * @param {string} mode - The filter mode to set (e.g., 'unread', 'starred').
 */
export async function setFilterMode(app, mode) {
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);

    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'filterMode',
        value: mode
    });

    if (isOnline()) {
        try {
            await processPendingOperations();
        } catch (syncErr) {
            console.error("Failed to immediately sync filter mode change, operation remains buffered:", syncErr);
        }
    }
}

/**
 * Loads the current filter mode from storage.
 * @returns {Promise<string>} The current filter mode.
 */
export async function loadFilterMode() {
    const {
        value: mode
    } = await loadSimpleState('filterMode');
    return mode || 'unread';
}