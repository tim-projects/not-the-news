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
    if (Array.isArray(storedItems)) {
        return storedItems.map(item => item.guid).filter(Boolean);
    }
    return [];
}

/**
 * Saves the current deck of GUIDs.
 * @param {Array<string>} guids - The array of GUIDs to save as the current deck.
 */
export async function saveCurrentDeck(guids) {
    const db = await getDb();
    const tx = db.transaction('currentDeckGuids', 'readwrite');
    const store = tx.objectStore('currentDeckGuids');

    await store.clear();
    for (const guid of guids) {
        await store.put({ guid: guid });
    }
    await tx.done;

    console.log(`[saveCurrentDeck] Saved ${guids.length} GUIDs to currentDeckGuids store.`);

    await addPendingOperation({
        type: 'simpleUpdate',
        key: 'currentDeckGuids',
        value: Array.from(guids)
    });

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