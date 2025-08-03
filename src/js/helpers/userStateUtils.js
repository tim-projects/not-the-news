// @filepath: src/js/helpers/userStateUtils.js

// Refactored JS: concise, modern, functional, same output.

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
    let newStarredList = [...app.starred];

    try {
        const existingIndex = newStarredList.findIndex(item => item.guid === guid);

        if (existingIndex > -1) {
            newStarredList.splice(existingIndex, 1);
            await store.delete(guid);
            action = "remove";
        } else {
            const newItem = { guid, starredAt };
            newStarredList.push(newItem);
            await store.put(newItem);
            action = "add";
        }

        await tx.done;

        app.starred = newStarredList;
        if (typeof app.updateCounts === 'function') app.updateCounts();

        const deltaObject = { itemGuid: guid, action, starredAt };
        await addPendingOperation({ type: 'starDelta', data: deltaObject });

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
    let action;
    
    const existingIndex = app.hidden.findIndex(item => item.guid === guid);
    let newHiddenList = [...app.hidden];

    try {
        if (existingIndex > -1) {
            newHiddenList.splice(existingIndex, 1);
            await store.delete(guid);
            action = 'remove';
            createStatusBarMessage('Item unhidden.', 'info');
        } else {
            const hiddenAt = new Date().toISOString();
            const newItem = { guid, hiddenAt };
            newHiddenList.push(newItem);
            await store.put(newItem);
            action = 'add';
            createStatusBarMessage('Item hidden.', 'info');
        }

        await tx.done; // Ensure transaction completes

        app.hidden = newHiddenList;
        await addPendingOperation({ type: 'hiddenDelta', data: { action, itemGuid: guid } });

        if (isOnline()) {
            await processPendingOperations();
        }
        
        app.updateCounts();
    } catch (error) {
        console.error("Error in toggleHidden:", error);
    }
}

/**
 * Prunes stale hidden items from the hiddenItems store and returns the updated list.
 * Items are considered stale if they are not in the current feedItems and are older than 30 days.
 * @param {Array<object>} feedItems - The array of current feed items (expected to have 'guid' property).
 * @param {Array<object>} hiddenItems - The current array of hidden items from the app state.
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(feedItems, hiddenItems, currentTS) {
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return hiddenItems;

    const validFeedGuids = new Set(feedItems.map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const itemsToKeep = hiddenItems.filter(item => {
        const normalizedGuid = String(item.guid).trim().toLowerCase();
        // Keep if it's a current feed item, or if it's not and less than 30 days old.
        if (validFeedGuids.has(normalizedGuid)) return true;
        const hiddenAtTS = new Date(item.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
    });

    // If the list of items to keep is different, save the new list to the database
    if (itemsToKeep.length !== hiddenItems.length) {
        try {
            const db = await getDb();
            const tx = db.transaction('hiddenItems', 'readwrite');
            const store = tx.objectStore('hiddenItems');
            await store.clear();
            await Promise.all(itemsToKeep.map(item => store.put(item)));
            await tx.done;
            console.log(`Pruned hidden items: removed ${hiddenItems.length - itemsToKeep.length} stale items.`);
        } catch (error) {
            console.error("Error pruning stale hidden items:", error);
        }
    }
    
    return itemsToKeep;
}

/**
 * Loads the current deck of GUIDs.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    const { value: storedItems } = await loadSimpleState('currentDeckGuids');
    
    // Ensure the stored value is an array of strings.
    const deckGuids = Array.isArray(storedItems) ? storedItems.filter(guid => typeof guid === 'string') : [];
    
    console.log(`[loadCurrentDeck] Loaded ${deckGuids.length} GUIDs.`);
    return deckGuids;
}

/**
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store
 * and queues a corresponding sync operation.
 *
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
        console.error("[saveCurrentDeck] Invalid input: expected an array of GUIDs, got:", typeof guids, guids);
        return;
    }
    
    console.log("[saveCurrentDeck] Saving", guids.length, "GUIDs.");
    
    try {
        await saveSimpleState('currentDeckGuids', guids);
        
        await addPendingOperation({
            type: 'simpleUpdate',
            key: 'currentDeckGuids',
            value: guids
        });
        
        if (isOnline()) {
            await processPendingOperations();
        }
    } catch (e) {
        console.error("[saveCurrentDeck] An error occurred:", e);
        throw e;
    }
}

/**
 * Loads the shuffle state, including shuffle count, last reset date.
 * @returns {Promise<{shuffleCount: number, lastShuffleResetDate: string}>} The shuffle state.
 */
export async function loadShuffleState() {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2,
        lastShuffleResetDate: lastShuffleResetDate || new Date().toDateString(),
    };
}

/**
 * Saves the shuffle state, including shuffle count, last reset date.
 * @param {number} count - The current shuffle count.
 * @param {string} resetDate - The date of the last shuffle reset (as a string).
 */
export async function saveShuffleState(count, resetDate) {
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate);

    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'shuffleCount',
        value: count
    });
    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'lastShuffleResetDate',
        value: resetDate
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