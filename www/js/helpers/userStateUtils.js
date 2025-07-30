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
} from '../data/database.js'; // Assuming database.js imports dbCore and dbUserState

// Ensure these imports exist as specified in the prompt for toggleHidden
import { createStatusBarMessage } from '../ui/uiUpdaters.js';


/**
 * Toggles the starred status of an item and manages synchronization.
 * @param {object} app - The main application state object (e.g., Vue instance).
 * @param {string} guid - The unique identifier of the item (this is an RSS item GUID).
 */
export async function toggleStar(app, guid) {
    const db = await getDb();
    const tx = db.transaction('starredItems', 'readwrite'); // 'starredItems' uses 'guid' as keyPath
    const store = tx.objectStore('starredItems');

    const starredAt = new Date().toISOString();
    let action;

    try {
        // When using `store.get(key)`, the key should be the value of the keyPath, which is 'guid'.
        const existingItem = await store.get(guid);

        if (existingItem) {
            // Item is currently starred, so unstar it
            await store.delete(guid); // Delete using the guid
            action = "remove";
            // Update app's in-memory starred list: filter by the item's GUID
            app.starred = app.starred.filter(item => item.guid !== guid); // ***CHANGED: Use item.guid***
        } else {
            // Item is not starred, so star it
            // The object stored needs to have the 'guid' property because it's the keyPath.
            await store.put({
                guid: guid, // ***CHANGED: keyPath is 'guid', not 'id'***
                starredAt
            });
            action = "add";
            // Update app's in-memory starred list: push an object with 'guid'
            app.starred.push({
                guid: guid, // ***CHANGED: Use guid***
                starredAt
            });
        }

        await tx.done; // Ensure the transaction completes

        // Trigger UI update if necessary
        if (typeof app.updateCounts === 'function') app.updateCounts();

        // Add the operation to the persistent pending operations buffer.
        // This operation will go into 'pendingOperations' which uses 'id' (autoIncrement).
        // The 'data' field will contain the details of the star change, using 'guid' for the item.
        const deltaObject = {
            itemGuid: guid, // Renamed 'id' to 'itemGuid' to avoid confusion with pendingOperation.id
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
 * @param {string} guid - The unique identifier of the item (this is an RSS item GUID).
 */
export async function toggleHidden(app, guid) {
    // The 'hiddenItems' store uses 'guid' as its keyPath.
    const db = await getDb();
    const tx = db.transaction('hiddenItems', 'readwrite'); // 'hiddenItems' uses 'guid' as keyPath
    const store = tx.objectStore('hiddenItems');

    // Find in app's in-memory 'hidden' array, which should store objects with 'guid'.
    const existingIndex = app.hidden.findIndex(item => item.guid === guid); // ***CHANGED: Use item.guid***

    if (existingIndex > -1) {
        // Unhide item
        app.hidden.splice(existingIndex, 1);
        await store.delete(guid); // Delete from IndexedDB using the guid
        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'remove', itemGuid: guid } }); // ***CHANGED: itemGuid***
        createStatusBarMessage('Item unhidden.', 'info');
    } else {
        // Hide item
        const hiddenAt = new Date().toISOString();
        // The object stored needs to have the 'guid' property because it's the keyPath.
        await store.put({
            guid: guid, // ***CHANGED: keyPath is 'guid', not 'id'***
            hiddenAt
        });
        app.hidden.push({ guid: guid, hiddenAt: hiddenAt }); // ***CHANGED: Use guid***

        await addPendingOperation({ type: 'hiddenDelta', data: { action: 'add', itemGuid: guid, timestamp: hiddenAt } }); // ***CHANGED: itemGuid***
        createStatusBarMessage('Item hidden.', 'info');
    }

    // Save the updated hidden array to IndexedDB.
    // NOTE: `saveArrayState('hidden', app.hidden)` saves to 'userSettings' if 'hidden' is in USER_STATE_DEFS.
    // If 'hiddenItems' is a separate store for individual hidden items, then the `store.put/delete` calls above are correct.
    // You might not need `saveArrayState('hidden', app.hidden)` here if `hiddenItems` is the canonical source.
    // If 'hidden' in `app.hidden` is meant to be a simple array of *only* GUIDs, it might be better handled differently.
    // Assuming `app.hidden` holds objects like `{guid: '...', hiddenAt: '...'}` that mirror the store.
    // If `hidden` in `USER_STATE_DEFS` refers to `hiddenItems` store, this line is redundant for persistence.
    // If `app.hidden` is a distinct setting (e.g., a simple array of GUIDs) in `userSettings`, then this is fine.
    // Clarify later if needed, but for now, keep it as it's not breaking.
    // await saveArrayState('hidden', app.hidden); // This might be redundant if `hiddenItems` is the source of truth

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
    // Fetch directly from the 'hiddenItems' store, which uses 'guid' as keyPath.
    const hiddenItemsFromStore = await db.transaction('hiddenItems', 'readonly').objectStore('hiddenItems').getAll();

    // Basic validation
    if (!Array.isArray(hiddenItemsFromStore)) return [];
    // Feed items are expected to have a 'guid' property now.
    if (!Array.isArray(feedItems) || feedItems.length === 0 || !feedItems.every(e => e && typeof e.guid === 'string')) return hiddenItemsFromStore; // ***CHANGED: e.guid***

    const validFeedGuids = new Set(feedItems.map(e => e.guid.trim().toLowerCase())); // ***CHANGED: e.guid***
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const itemsToDelete = hiddenItemsFromStore.filter(i => {
        // Items in hiddenItems store should have 'guid' as their key.
        const normalizedGuid = String(i.guid).trim().toLowerCase(); // ***CHANGED: i.guid***
        // Keep if the item is still present in the current feed
        if (validFeedGuids.has(normalizedGuid)) return false;
        // Check if the item is older than 30 days
        const hiddenAtTS = new Date(i.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) >= THIRTY_DAYS_MS;
    });

    if (itemsToDelete.length > 0) {
        const tx = db.transaction('hiddenItems', 'readwrite');
        const store = tx.objectStore('hiddenItems');
        try {
            for (const item of itemsToDelete) {
                await store.delete(item.guid); // ***CHANGED: Delete using item.guid***
            }
            await tx.done; // Wait for all deletes to complete
            // After successful deletion, filter the in-memory list to return the pruned list
            return hiddenItemsFromStore.filter(item => !itemsToDelete.includes(item));
        } catch (error) {
            console.error("Error pruning stale hidden items:", error);
            return hiddenItemsFromStore;
        }
    }
    return hiddenItemsFromStore; // No items to prune, return original list
}


/**
 * Loads the current deck of GUIDs.
 * This function now relies on `loadArrayState` which operates on the `currentDeckGuids` store.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of GUIDs.
 */
export async function loadCurrentDeck() {
    // The 'currentDeckGuids' store uses 'guid' as its keyPath.
    // It seems to store objects { guid: 'some-guid' }.
    // If you want just an array of strings (the GUIDs), you'll need to map them.
    const { value: storedItems } = await loadArrayState('currentDeckGuids'); // This loads from 'userSettings' if USER_STATE_DEFS points to it.
                                                                           // If 'currentDeckGuids' is its own store (as per dbCore.js),
                                                                           // then loadArrayState needs to be compatible with that.
                                                                           // Assuming loadArrayState loads the *contents* of 'currentDeckGuids' store as an array of objects.
    if (Array.isArray(storedItems)) {
        return storedItems.map(item => item.guid).filter(Boolean); // Map to just the GUID strings
    }
    return [];
}

/**
 * Saves the current deck of GUIDs.
 * This function now uses a direct IndexedDB transaction for the 'currentDeckGuids' store
 * and also buffers the operation for server sync.
 * @param {Array<string>} guids - The array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    const db = await getDb();
    const tx = db.transaction('currentDeckGuids', 'readwrite');
    const store = tx.objectStore('currentDeckGuids');

    // Clear existing data and add new guids as objects with the 'guid' keyPath.
    await store.clear(); // Clear all existing records
    for (const guid of guids) {
        await store.put({ guid: guid }); // Store each GUID as an object { guid: '...' }
    }
    await tx.done;

    console.log(`[saveCurrentDeck] Saved ${guids.length} GUIDs to currentDeckGuids store.`);

    // --- NEW/UPDATED: Register background sync if available ---
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('data-sync'); // Register the 'data-sync' tag
            console.log('[UserState] Background sync registered for currentDeckGuids update.');
        } catch (error) {
            console.warn('[UserState] Background sync registration failed for currentDeckGuids:', error);
        }
    }

    // Add the operation to the pending operations buffer for server sync
    // This operation is a 'simpleUpdate' on 'user-state', NOT a feed item.
    // It should NOT have a 'guid' property on the operation object itself.
    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'currentDeckGuids',
        value: Array.from(guids) // Send the entire array of GUIDs to the server
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
 * Loads the shuffle state, including shuffle count, last reset date.
 * @returns {Promise<{shuffleCount: number, lastShuffleResetDate: Date|null}>} The shuffle state.
 */
export async function loadShuffleState() {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2, // Default if not found or invalid
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

    // Add these simple updates to the pending operations buffer
    // These operations should NOT have a 'guid' property on the operation object itself.
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

    // --- NEW/UPDATED: Register background sync if available ---
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('data-sync'); // Register the 'data-sync' tag
            console.log('[UserState] Background sync registered for shuffle state update.');
        } catch (error) {
            console.warn('[UserState] Background sync registration failed for shuffle state:', error);
        }
    }

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

    // Add this simple update to the pending operations buffer
    // This operation should NOT have a 'guid' property on the operation object itself.
    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'filterMode',
        value: mode
    });

    // --- NEW/UPDATED: Register background sync if available ---
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
        try {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('data-sync'); // Register the 'data-sync' tag
            console.log('[UserState] Background sync registered for filter mode update.');
        } catch (error) {
            console.warn('[UserState] Background sync registration failed for filter mode:', error);
        }
    }

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
    return mode || 'unread'; // Provide a default if not found
}