// @filepath: src/js/helpers/userStateUtils.js

// This file contains helper functions for managing user state and syncing with the server.
// It relies on the synchronized database functions for all data access.

import {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    saveArrayState,
    queueAndAttemptSyncOperation
} from '../data/database.js';

import { isOnline } from '../utils/connectivity.js';
import { createStatusBarMessage } from '../ui/uiUpdaters.js';

/**
 * Toggles an item's state (e.g., starred or hidden) and syncs it with the server.
 * This function consolidates the logic from `toggleStar` and `toggleHidden`.
 * @param {object} app The Alpine.js app state object.
 * @param {string} guid The unique identifier of the feed item.
 * @param {string} stateKey The key for the state to toggle ('starred' or 'hidden').
 */
export async function toggleItemStateAndSync(app, guid, stateKey) {
    const isCurrentlyActive = app[stateKey].some(item => item.guid === guid);
    const action = isCurrentlyActive ? 'remove' : 'add';
    const timestamp = new Date().toISOString();

    const opType = `${stateKey}Delta`;
    const pendingOp = {
        type: opType,
        data: {
            itemGuid: guid,
            action,
            timestamp
        }
    };

    // Update local state and DB for immediate UI feedback.
    let newList;
    if (isCurrentlyActive) {
        newList = app[stateKey].filter(item => item.guid !== guid);
    } else {
        newList = [...app[stateKey], {
            guid,
            timestamp
        }];
    }
    app[stateKey] = newList;
    await saveArrayState(stateKey, newList);

    if (stateKey === 'hidden') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unhidden.' : 'Item hidden.', 'info');
    }

    if (typeof app.updateCounts === 'function') app.updateCounts();

    // Queue and attempt to sync the change.
    await queueAndAttemptSyncOperation(pendingOp);
}

/**
 * A pure function to prune stale hidden items from the hiddenItems list.
 * Items are considered stale if they are not in the current feedItems and are older than 30 days.
 * This function does NOT modify the database.
 * @param {Array<object>} feedItems - The array of current feed items (expected to have 'guid' property).
 * @param {Array<object>} hiddenItems - The current array of hidden items from the app state.
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(feedItems, hiddenItems, currentTS) {
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return hiddenItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const itemsToKeep = hiddenItems.filter(item => {
        const normalizedGuid = String(item.guid).trim().toLowerCase();
        // Keep if it's a current feed item, or if it's not and less than 30 days old.
        if (validFeedGuids.has(normalizedGuid)) return true;
        const hiddenAtTS = new Date(item.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
    });

    return itemsToKeep;
}

/**
 * Loads the current list of hidden items, prunes the stale ones,
 * saves the changes to the database, and returns the final list.
 * This function should be called during app startup to ensure a clean state.
 * @param {Array<object>} feedItems - The array of current feed items.
 * @returns {Promise<Array<object>>} The updated list of hidden items.
 */
export async function loadAndPruneHiddenItems(feedItems) {
    const { value: hiddenItems } = await loadArrayState('hidden');
    const prunedHiddenItems = await pruneStaleHidden(feedItems, hiddenItems, Date.now());

    if (prunedHiddenItems.length !== hiddenItems.length) {
        try {
            await saveArrayState('hidden', prunedHiddenItems);
            console.log(`Pruned hidden items: removed ${hiddenItems.length - prunedHiddenItems.length} stale items.`);
        } catch (error) {
            console.error("Error pruning stale hidden items:", error);
        }
    }

    return prunedHiddenItems;
}

/**
 * Loads the current deck of GUIDs.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
/**
 * Loads the current deck of GUIDs.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    const { value: storedItems } = await loadArrayState('currentDeckGuids');
    
    console.log(`[loadCurrentDeck] Raw stored data:`, storedItems);
    console.log(`[loadCurrentDeck] First item structure:`, storedItems?.[0]);
    
    // FIX: The load function should expect an array of strings, as that is the correct format.
    // However, it's good practice to handle the old, incorrect format as a fallback.
    // If the data is an array of objects, map it to strings. Otherwise, use the data directly.
    const deckGuids = storedItems?.map(item => {
        if (typeof item === 'string') {
            return item;
        }
        if (item && typeof item === 'object') {
            // Handle various object formats that might contain the GUID
            if (typeof item.guid === 'string') return item.guid;
            if (typeof item.id === 'string') return item.id;
            // If it's a proxy object, try to extract the underlying value
            if (item.valueOf && typeof item.valueOf() === 'string') return item.valueOf();
            // Try to convert to string as last resort
            const stringified = String(item);
            if (stringified !== '[object Object]') return stringified;
        }
        console.warn(`[loadCurrentDeck] Invalid GUID format:`, item, typeof item);
        return null;
    }).filter(guid => guid && typeof guid === 'string') || [];
    
    console.log(`[loadCurrentDeck] Processed ${deckGuids.length} GUIDs:`, deckGuids.slice(0, 3));
    return deckGuids;
}

/**
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store
 * and queues a corresponding sync operation.
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
        console.error("[saveCurrentDeck] Invalid input: expected an array of GUIDs, got:", typeof guids, guids);
        return;
    }
    console.log("[saveCurrentDeck] Saving", guids.length, "GUIDs:", guids);

    try {
        // FIX: The save function should save the GUIDs array directly, not an array of objects.
        await saveArrayState('currentDeckGuids', guids);

        // FIX: Deep clone the array before sending to the database.
        // This prevents a DataCloneError if the array is an Alpine.js proxy.
        const clonedGuids = JSON.parse(JSON.stringify(guids));

        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: 'currentDeckGuids',
            value: clonedGuids
        });
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
    const {
        value: shuffleCount
    } = await loadSimpleState('shuffleCount');
    const {
        value: lastShuffleResetDate
    } = await loadSimpleState('lastShuffleResetDate');

    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2,
        lastShuffleResetDate: lastShuffleResetDate || new Date().toDateString(),
    };
}

/**
 * Saves the shuffle state, including shuffle count, last reset date.
 * @param {number} count The current shuffle count.
 * @param {string} resetDate The date of the last shuffle reset (as a string).
 */
export async function saveShuffleState(count, resetDate) {
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate);

    await queueAndAttemptSyncOperation({
        type: 'simpleUpdate',
        key: 'shuffleCount',
        value: count
    });
    await queueAndAttemptSyncOperation({
        type: 'simpleUpdate',
        key: 'lastShuffleResetDate',
        value: resetDate
    });
}

/**
 * Sets the current filter mode for the application.
 * @param {object} app The main application state object.
 * @param {string} mode The filter mode to set (e.g., 'unread', 'starred').
 */
export async function setFilterMode(app, mode) {
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);

    await queueAndAttemptSyncOperation({
        type: 'simpleUpdate',
        key: 'filterMode',
        value: mode
    });
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
