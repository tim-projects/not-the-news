// www/js/helpers/userStateUtils.js

import {
    loadSimpleState,
    saveSimpleState,
    addPendingOperation,
    processPendingOperations,
    isOnline,
    loadArrayState,
    saveArrayState,
    getDb
} from '../data/database.js'; // Adjusted path to database.js


/**
 * Toggles the starred status of an item and manages synchronization.
 * @param {object} app - The main application state object (e.g., Vue instance).
 * @param {string} guid - The unique identifier of the item.
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
        await addPendingOperation({
            type: 'starDelta',
            data: deltaObject
        });

        // Attempt immediate background sync if online
        if (isOnline()) {
            try {
                await processPendingOperations();
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
    let { shuffleCount, lastShuffleResetDate, itemsClearedCount } = await loadShuffleState(); // Load latest counts
    let updateShuffleCount = false;

    const existingIndex = app.hidden.findIndex(item => item.id === guid);

    if (existingIndex > -1) {
        // Unhide item
        app.hidden.splice(existingIndex, 1);
        // Decrement itemsClearedCount if unhiding to maintain accuracy, but don't go below zero
        itemsClearedCount = Math.max(0, itemsClearedCount - 1);
        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'remove', guid: guid } });
        // Assuming createStatusBarMessage is available in the scope or globally
        // createStatusBarMessage('Item unhidden.', 'info');
    } else {
        // Hide item
        app.hidden.push({ id: guid, hiddenAt: new Date().toISOString() });
        itemsClearedCount++; // Increment count for items cleared
        if (itemsClearedCount % 10 === 0) {
            // Increment shuffleCount every 10 items
            shuffleCount++;
            updateShuffleCount = true;
            // Assuming createStatusBarMessage is available in the scope or globally
            // createStatusBarMessage('Shuffle count increased!', 'success');
        }
        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'add', guid: guid, timestamp: new Date().toISOString() } });
        // Assuming createStatusBarMessage is available in the scope or globally
        // createStatusBarMessage('Item hidden.', 'info');
    }

    await saveArrayState('hidden', app.hidden); // Save the updated hidden array
    if (updateShuffleCount) {
        // Only save shuffleCount and itemsClearedCount if shuffleCount was updated
        await saveShuffleState(shuffleCount, lastShuffleResetDate, itemsClearedCount);
        app.shuffleCount = shuffleCount; // Update Alpine state immediately for UI
    } else {
        // Always save itemsClearedCount
        await saveShuffleState(shuffleCount, lastShuffleResetDate, itemsClearedCount);
    }

    // Ensure app.updateCounts is a function before calling it
    if (typeof app.updateCounts === 'function') {
        app.updateCounts();
    }
    // The deck regeneration is handled by app.js after this call.
}

/**
 * Prunes stale hidden items from the hiddenItems store.
 * Items are considered stale if they are not in the current feedItems and are older than 30 days.
 * @param {Array<object>} feedItems - The array of current feed items (expected to have 'id' property).
 * @param {number} currentTS - The current timestamp in milliseconds.
 * @returns {Promise<Array<object>>} The updated list of hidden items after pruning.
 */
export async function pruneStaleHidden(feedItems, currentTS) {
    const db = await getDb();
    const {
        value: hiddenItems
    } = await loadArrayState('hidden');

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
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    const db = await getDb();
    const {
        value: guids
    } = await loadArrayState('currentDeckGuids');
    return Array.isArray(guids) ? guids : [];
}

/**
 * Saves the current deck of GUIDs.
 * This function now uses a direct IndexedDB transaction for the 'currentDeckGuids' store
 * and also buffers the operation for server sync.
 * @param {Array<string>} guids - The array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    const db = await getDb();
    await saveArrayState('currentDeckGuids', guids);

    console.log(`[saveCurrentDeck] Saved ${guids.length} GUIDs to currentDeckGuids store.`);

    // Add the operation to the pending operations buffer for server sync
    await addPendingOperation({
        type: 'simpleUpdate', // This type indicates it uses the generic /user-state POST
        key: 'currentDeckGuids',
        value: Array.from(guids) // Send the entire array to the server
    });

    // Attempt immediate background sync if online
    if (isOnline()) {
        try {
            await processPendingOperations();
        } catch (syncErr) {
            console.error("Failed to immediately sync currentDeckGuids change, operation remains buffered:", syncErr);
        }
    }
}

/**
 * Loads the shuffle state, including shuffle count, last reset date, and items cleared count.
 * @returns {Promise<{shuffleCount: number, lastShuffleResetDate: Date|null, itemsClearedCount: number}>} The shuffle state.
 */
export async function loadShuffleState() {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    const { value: itemsClearedCount } = await loadSimpleState('itemsClearedCount'); // NEW
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2, // Default if not found or invalid
        lastShuffleResetDate: lastShuffleResetDate ? new Date(lastShuffleResetDate) : null,
        itemsClearedCount: itemsClearedCount || 0 // NEW: Ensure default to 0
    };
}

/**
 * Saves the shuffle state, including shuffle count, last reset date, and items cleared count.
 * @param {number} count - The current shuffle count.
 * @param {Date|null} resetDate - The date of the last shuffle reset.
 * @param {number} itemsClearedCount - The count of items cleared.
 */
export async function saveShuffleState(count, resetDate, itemsClearedCount) { // MODIFIED parameters
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate ? resetDate.toISOString() : null);
    await saveSimpleState('itemsClearedCount', itemsClearedCount); // NEW

    // Add these simple updates to the pending operations buffer
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
    await addPendingOperation({ // NEW
        type: 'simpleUpdate',
        key: 'itemsClearedCount',
        value: itemsClearedCount
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
    const db = await getDb();
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);

    // Add this simple update to the pending operations buffer
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
    const db = await getDb();
    const {
        value: mode
    } = await loadSimpleState('filterMode');
    return mode || 'unread'; // Provide a default if not found
}