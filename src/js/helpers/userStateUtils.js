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
        // --- FIX: Use a computed key to match the stateKey (e.g., 'hiddenAt', 'starredAt') ---
        newList = [...app[stateKey], {
            guid,
            [`${stateKey}At`]: timestamp
        }];
        // --- END FIX ---
    }
    app[stateKey] = newList;
    
    // --- FIX: Save only the GUID strings to the database to avoid DataCloneError ---
    const guidsToSave = newList.map(item => item.guid);
    await saveArrayState(stateKey, guidsToSave);
    // --- END FIX ---

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
    // --- FIX: This function assumes that the database stores arrays of GUIDs and loads them as such.
    // However, the rest of the application expects objects with timestamps.
    // The previous `toggleItemStateAndSync` fix stored GUIDs, so we must now load them as GUIDs.
    // We can then create the expected object structure with a null timestamp to maintain compatibility.
    // The database is no longer saving the timestamps for these items.
    const { value: hiddenGuids } = await loadArrayState('hidden');
    const hiddenItemsWithTimestamps = Array.isArray(hiddenGuids) ? hiddenGuids.map(guid => ({
        guid,
        hiddenAt: null
    })) : [];

    const prunedHiddenItems = await pruneStaleHidden(feedItems, hiddenItemsWithTimestamps, Date.now());

    if (prunedHiddenItems.length !== hiddenItemsWithTimestamps.length) {
        try {
            // Now, we must save only the GUIDs back to the database.
            const guidsToSave = prunedHiddenItems.map(item => item.guid);
            await saveArrayState('hidden', guidsToSave);
            console.log(`Pruned hidden items: removed ${hiddenItemsWithTimestamps.length - prunedHiddenItems.length} stale items.`);
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
export async function loadCurrentDeck() {
    // --- FIX: Remove the messy fallback logic.
    // Now that the data is consistently saved as an array of strings, we can
    // simply load it and filter out any invalid entries.
    const { value: storedGuids } = await loadArrayState('currentDeckGuids');
    const deckGuids = storedGuids?.filter(guid => typeof guid === 'string' && guid) || [];
    console.log(`[loadCurrentDeck] Processed ${deckGuids.length} GUIDs.`);
    return deckGuids;
    // --- END FIX ---
}

/**
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store
 * and queues a corresponding sync operation.
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids) || !guids.every(g => typeof g === 'string' && g)) {
        console.error("[saveCurrentDeck] Invalid input: expected an array of non-empty GUID strings.");
        return;
    }
    console.log("[saveCurrentDeck] Saving", guids.length, "GUIDs:", guids.slice(0, 3));

    try {
        // The saveArrayState function now expects an array of strings.
        await saveArrayState('currentDeckGuids', guids);

        // Deep clone the array before sending to the database.
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