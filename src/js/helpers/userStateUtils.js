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

    await updateArrayState(stateKey, guid, !isCurrentlyActive);

    let newAppList;
    if (isCurrentlyActive) {
        newAppList = app[stateKey].filter(item => item.guid !== guid);
    } else {
        newAppList = [...app[stateKey], {
            guid,
            [`${stateKey}At`]: pendingOp.data.timestamp
        }];
    }
    app[stateKey] = newAppList;
    
    if (stateKey === 'hidden') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unhidden.' : 'Item hidden.', 'info');
    } else if (stateKey === 'starred') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unstarred.' : 'Item starred.', 'info');
    }

    if (typeof app.updateCounts === 'function') app.updateCounts();

    await queueAndAttemptSyncOperation(pendingOp);
}

/**
 * A pure function to prune stale hidden items from the hiddenItems list.
 * @param {Array<object>} feedItems - The array of current feed items.
 * @param {Array<object>} hiddenItems - The current array of hidden items (already normalized).
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(feedItems, hiddenItems, currentTS) {
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return hiddenItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    return hiddenItems.filter(item => {
        if (!item || !item.guid) return false; // Safety check

        const normalizedGuid = String(item.guid).trim().toLowerCase();
        if (validFeedGuids.has(normalizedGuid)) return true;

        if (item.hiddenAt) {
            const hiddenAtTS = new Date(item.hiddenAt).getTime();
            if (!isNaN(hiddenAtTS)) {
                return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
            }
        }
        return false;
    });
}

/**
 * Loads, sanitizes, normalizes, and prunes hidden items.
 * @param {Array<object>} feedItems - The array of current feed items.
 * @returns {Promise<Array<object>>} The updated list of hidden items.
 */
export async function loadAndPruneHiddenItems(feedItems) {
    const { value: rawHiddenItems } = await loadArrayState('hidden');

    // FIX: Sanitize and normalize the data in one step.
    // 1. Ensure it's an array.
    // 2. Filter out any invalid entries (null, undefined, empty strings).
    // 3. Map the clean data to the new object format.
    const normalizedItems = (Array.isArray(rawHiddenItems))
        ? rawHiddenItems
              .filter(guid => typeof guid === 'string' && guid) // Sanitize the data
              .map(guid => ({ guid, hiddenAt: new Date().toISOString() })) // Normalize to objects
        : [];

    const prunedHiddenItems = await pruneStaleHidden(feedItems, normalizedItems, Date.now());

    // Save back to the database if the data has been cleaned, pruned, or migrated.
    const isMigrated = Array.isArray(rawHiddenItems) && typeof rawHiddenItems[0] === 'string';
    if (prunedHiddenItems.length !== normalizedItems.length || isMigrated) {
        try {
            await saveArrayState('hidden', prunedHiddenItems);
            console.log(`Pruned or normalized hidden items: removed ${normalizedItems.length - prunedHiddenItems.length} stale items.`);
        } catch (error) {
            console.error("Error saving pruned hidden items:", error);
            // Don't re-throw, as we can continue with the in-memory version.
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
 * Saves a new array of deck GUIDs to the 'currentDeckGuids' IndexedDB store.
 * @param {string[]} guids An array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array.");
         return;
    }
    
    // FIX: Sanitize the incoming array to prevent crashes from bad data.
    const validGuids = guids.filter(g => typeof g === 'string' && g);

    if (validGuids.length !== guids.length) {
        console.warn("[saveCurrentDeck] Filtered out invalid GUIDs from the generated deck.");
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
        // Do not re-throw, to prevent crashing the entire app flow.
    }
}


// --- Unchanged Functions Below ---

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