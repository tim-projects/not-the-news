// @filepath: src/js/helpers/userStateUtils.js

// This file contains helper functions for managing user state and syncing with the server.
// It relies on the synchronized database functions for all data access.

import {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    saveArrayState,
    queueAndAttemptSyncOperation,
    updateArrayState
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
    // Determine the current state based on the presence of the GUID in the local state array.
    const isCurrentlyActive = app[stateKey].some(item => item.guid === guid);
    const action = isCurrentlyActive ? 'remove' : 'add';

    const opType = `${stateKey}Delta`;
    const pendingOp = {
        type: opType,
        data: {
            itemGuid: guid,
            action,
            timestamp: new Date().toISOString()
        }
    };

    // Update the local database. This is robust and correct.
    await updateArrayState(stateKey, guid, !isCurrentlyActive);

    // Update the app's reactive state correctly to trigger UI updates.
    // By creating a new array, we ensure Alpine.js detects the change.
    let newAppList;
    if (isCurrentlyActive) {
        newAppList = app[stateKey].filter(item => item.guid !== guid);
    } else {
        newAppList = [...app[stateKey], {
            guid,
            [`${stateKey}At`]: pendingOp.data.timestamp
        }];
    }
    // Reassign the new array to the app's state.
    app[stateKey] = newAppList;
    
    if (stateKey === 'hidden') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unhidden.' : 'Item hidden.', 'info');
    } else if (stateKey === 'starred') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unstarred.' : 'Item starred.', 'info');
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
        // FIX: Make pruning logic more robust.
        if (!item || !item.guid) return false; // Discard invalid items immediately.

        const normalizedGuid = String(item.guid).trim().toLowerCase();
        // 1. Always keep items that are still in the main feed.
        if (validFeedGuids.has(normalizedGuid)) return true;

        // 2. For items no longer in the feed, only prune them if they have a valid date and are older than 30 days.
        if (item.hiddenAt) {
            const hiddenAtTS = new Date(item.hiddenAt).getTime();
            if (!isNaN(hiddenAtTS)) {
                return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
            }
        }
        
        // 3. If the item is no longer in the feed and has no valid date, it's safer to remove it.
        return false;
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
    const { value: rawHiddenItems } = await loadArrayState('hidden');

    // Data normalization/migration step.
    const hiddenItems = (Array.isArray(rawHiddenItems) && typeof rawHiddenItems[0] === 'string')
        ? rawHiddenItems.map(guid => ({ guid, hiddenAt: new Date().toISOString() }))
        : (rawHiddenItems || []);

    const prunedHiddenItems = await pruneStaleHidden(feedItems, hiddenItems, Date.now());

    const originalLength = Array.isArray(rawHiddenItems) ? rawHiddenItems.length : 0;
    // Only save if a meaningful change happened (pruning or format change).
    if (prunedHiddenItems.length !== originalLength || typeof rawHiddenItems[0] === 'string') {
        try {
            await saveArrayState('hidden', prunedHiddenItems);
            console.log(`Pruned or normalized hidden items: removed ${originalLength - prunedHiddenItems.length} stale items.`);
        } catch (error) {
            console.error("Error saving pruned hidden items:", error);
        }
    }

    return prunedHiddenItems;
}

/**
 * Loads the current deck of GUIDs.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    const { value: storedObjects } = await loadArrayState('currentDeckGuids');
    
    const deckGuids = Array.isArray(storedObjects)
        ? storedObjects.map(item => item.guid).filter(guid => typeof guid === 'string' && guid)
        : [];
        
    console.log(`[loadCurrentDeck] Processed ${deckGuids.length} GUIDs.`);
    return deckGuids;
}

/**
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store
 * and queues a corresponding sync operation.
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array.");
         return;
    }
     // Filter out any potential undefined/null values before processing.
    const validGuids = guids.filter(g => typeof g === 'string' && g);

    if (validGuids.length !== guids.length) {
        console.warn("[saveCurrentDeck] Filtered out invalid GUIDs from deck.", { original: guids.length, valid: validGuids.length });
    }

    console.log("[saveCurrentDeck] Saving", validGuids.length, "GUIDs:", validGuids.slice(0, 3));

    try {
        const deckObjects = validGuids.map(guid => ({ guid }));
        await saveArrayState('currentDeckGuids', deckObjects);

        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: 'currentDeckGuids',
            value: JSON.parse(JSON.stringify(validGuids))
        });
    } catch (e) {
        console.error("[saveCurrentDeck] An error occurred:", e);
        throw e;
    }
}

// --- The rest of the file (loadShuffleState, saveShuffleState, etc.) remains unchanged ---
// (No changes are needed for the functions below this line)

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

export async function setFilterMode(app, mode) {
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);

    await queueAndAttemptSyncOperation({
        type: 'simpleUpdate',
        key: 'filterMode',
        value: mode
    });
}

export async function loadFilterMode() {
    const {
        value: mode
    } = await loadSimpleState('filterMode');
    return mode || 'unread';
}