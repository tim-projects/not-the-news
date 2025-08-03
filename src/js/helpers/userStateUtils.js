// @filepath: src/js/helpers/userStateUtils.js

// Refactored JS: concise, modern, functional, same output.

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation,
    processPendingOperations,
    loadArrayState,
    saveArrayState
} from '../data/database.js'; // These are now assumed to be re-exported from database.js

import { getDb } from '../data/dbCore.js'; // getDb is now exported from dbCore.js
import { isOnline } from '../utils/connectivity.js'; // <-- Corrected import path
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
    await addPendingOperation(pendingOp);
    if (isOnline()) {
        try {
            await processPendingOperations();
        } catch (syncErr) {
            console.error(`Failed to immediately sync ${stateKey} change, operation remains buffered:`, syncErr);
        }
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

    if (itemsToKeep.length !== hiddenItems.length) {
        try {
            await saveArrayState('hidden', itemsToKeep);
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
    // FIX: Changed to loadArrayState to match the corrected database schema.
    const { value: storedItems } = await loadArrayState('currentDeckGuids');
    const deckGuids = storedItems?.map(item => item.guid).filter(Boolean) || [];
    console.log(`[loadCurrentDeck] Loaded ${deckGuids.length} GUIDs.`);
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
    console.log("[saveCurrentDeck] Saving", guids.length, "GUIDs.");

    try {
        const guidsAsObjects = guids.map(guid => ({
            guid
        }));
        // FIX: Changed to saveArrayState to match the corrected database schema.
        await saveArrayState('currentDeckGuids', guidsAsObjects);

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
 * @param {object} app The main application state object.
 * @param {string} mode The filter mode to set (e.g., 'unread', 'starred').
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

// NOTE: The original getUserSetting and setUserSetting functions have been removed
// as their functionality is already provided by the more generic loadSimpleState
// and saveSimpleState functions, which are used throughout the application.