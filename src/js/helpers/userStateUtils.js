// @filepath: src/js/userStateUtils.js

import {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    saveArrayState, // <-- Add this import directly
    queueAndAttemptSyncOperation,
    updateArrayState,
    overwriteArrayAndSyncChanges
} from '../data/dbUserState.js'; // <-- Change import path

import { isOnline } from '../utils/connectivity.js';
import { createStatusBarMessage } from '../ui/uiUpdaters.js';

/**
 * A helper function to deeply clone an object, sanitizing it for IndexedDB storage.
 * It removes non-cloneable properties like functions.
 * @param {object} obj The object to sanitize.
 * @returns {object} A sanitized, cloneable copy of the object.
 */
function sanitizeForIndexedDB(obj) {
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(obj);
        } catch (e) {
            console.error("structuredClone failed, falling back to manual sanitization.", e);
        }
    }

    // Fallback for older browsers or complex, non-cloneable data
    // This is a manual recursive check that omits functions.
    const sanitized = {};
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value === 'object' && value !== null) {
                // Recursively sanitize nested objects and arrays
                if (Array.isArray(value)) {
                    sanitized[key] = value.map(item => sanitizeForIndexedDB(item));
                } else {
                    sanitized[key] = sanitizeForIndexedDB(value);
                }
            } else if (typeof value !== 'function') {
                // Copy primitive values, but omit functions
                sanitized[key] = value;
            }
        }
    }
    return sanitized;
}


export async function toggleItemStateAndSync(app, guid, stateKey) {
    const isCurrentlyActive = app[stateKey].some(item => item.guid === guid);
    const action = isCurrentlyActive ? 'remove' : 'add';
    const timestamp = new Date().toISOString();
    const actionVerb = stateKey.slice(0, -1); // e.g., 'star' from 'starred'

    // Create the full object that will be used for the database operation and local state.
    const itemObject = { guid, [`${actionVerb}At`]: timestamp };

    // Correctly call updateArrayState with the required arguments:
    // 1. storeName (string)
    // 2. item (object with .guid)
    // 3. add (boolean)
    await updateArrayState(stateKey, itemObject, action === 'add');

    // Update the local application state to match the database operation
    if (action === 'add') {
        app[stateKey] = [...app[stateKey], itemObject];
    } else {
        app[stateKey] = app[stateKey].filter(item => item.guid !== guid);
    }
    
    // Display status message to the user
    if (stateKey === 'read') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unread.' : 'Item read.', 'info');
    } else if (stateKey === 'starred') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unstarred.' : 'Item starred.', 'info');
    }

    // Update UI counts
    if (typeof app.updateCounts === 'function') app.updateCounts();

    // Queue the change for server-side synchronization
    const opType = `${stateKey}Delta`;
    const pendingOp = {
        type: opType,
        guid: guid,
        action: action,
        timestamp: timestamp
    };
    await queueAndAttemptSyncOperation(pendingOp);
}

export async function pruneStaleRead(feedItems, readItems, currentTS) {
    if (!Array.isArray(readItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return readItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    return readItems.filter(item => {
        if (!item || !item.guid) return false;

        const normalizedGuid = String(item.guid).trim().toLowerCase();
        if (validFeedGuids.has(normalizedGuid)) return true;

        // Use the timestamp on the object for pruning logic
        if (item.readAt) {
            const readAtTS = new Date(item.readAt).getTime();
            if (!isNaN(readAtTS)) {
                return (currentTS - readAtTS) < THIRTY_DAYS_MS;
            }
        }
        // If an item somehow has no timestamp, don't prune it.
        return true; 
    });
}

export async function loadAndPruneReadItems(feedItems) {
    const { value: rawItems } = await loadArrayState('read');
    let needsResave = false;
    
    // Data migration and normalization logic
    let normalizedItems = [];
    if (Array.isArray(rawItems)) {
        const defaultTimestamp = new Date().toISOString();
        for (const item of rawItems) {
            if (typeof item === 'string' && item) {
                // Legacy string data: migrate to object
                normalizedItems.push({ guid: item, readAt: defaultTimestamp });
                needsResave = true;
            } else if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid) {
                // Modern object data: ensure timestamp exists
                if (!item.readAt) {
                    item.readAt = defaultTimestamp;
                    needsResave = true;
                }
                normalizedItems.push(item);
            }
        }
    }

    const prunedItems = await pruneStaleRead(feedItems, normalizedItems, Date.now());

    if (prunedItems.length !== normalizedItems.length) {
        needsResave = true;
    }

    if (needsResave) {
        try {
            await saveArrayState('read', prunedItems);
            console.log(`Sanitized, pruned, or migrated read items. Original count: ${rawItems.length}, New count: ${prunedItems.length}`);
        } catch (error) {
            console.error("Error saving pruned read items:", error);
        }
    }

    return prunedItems;
}

export async function loadCurrentDeck() {
    const { value: storedObjects } = await loadArrayState('currentDeckGuids');
    
    // Handle migration for legacy string-based data
    if (storedObjects && storedObjects.length > 0 && typeof storedObjects[0] === 'string') {
        console.log('[loadCurrentDeck] Migrating legacy string-based deck data...');
        const defaultTimestamp = new Date().toISOString();
        const migratedObjects = storedObjects.map(guid => ({ guid, addedAt: defaultTimestamp }));
        await saveArrayState('currentDeckGuids', migratedObjects); // Resave in the new format
        console.log(`[loadCurrentDeck] Migration complete. Loaded ${migratedObjects.length} objects.`);
        return migratedObjects;
    }

    const deckObjects = Array.isArray(storedObjects)
        ? storedObjects.filter(item => typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid)
        : [];
        
    console.log(`[loadCurrentDeck] Loaded ${deckObjects.length} deck objects.`);
    return deckObjects;
}

export async function saveCurrentDeck(deckObjects) {
    if (!Array.isArray(deckObjects)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array of objects.");
         return;
    }
    
    // Validate that we are working with objects that have a valid GUID.
    const validDeckObjects = deckObjects.filter(item => typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid);

    if (validDeckObjects.length !== deckObjects.length) {
        console.warn("[saveCurrentDeck] Filtered out invalid items from the generated deck.");
    }

    console.log("[saveCurrentDeck] Saving", validDeckObjects.length, "deck objects.");

    try {
        // Sanitize the deck objects to remove any non-cloneable properties.
        const sanitizedDeckObjects = validDeckObjects.map(item => sanitizeForIndexedDB(item));

        // Overwrite the local database and queue the changes for synchronization.
        await overwriteArrayAndSyncChanges('currentDeckGuids', sanitizedDeckObjects);
    } catch (e) {
        console.error("[saveCurrentDeck] An error occurred while saving the deck:", e);
    }
}


// --- Unchanged Functions Below ---

export async function loadShuffleState() {
    const { value: shuffleCount } = await loadSimpleState('shuffleCount');
    const { value: lastShuffleResetDate } = await loadSimpleState('lastShuffleResetDate');
    return {
        shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : 2,
        lastShuffleResetDate: lastShuffleResetDate || new Date().toDateString(),
    };
}

export async function saveShuffleState(count, resetDate) {
    await saveSimpleState('shuffleCount', count);
    await saveSimpleState('lastShuffleResetDate', resetDate);
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'shuffleCount', value: count });
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'lastShuffleResetDate', value: resetDate });
}

export async function setFilterMode(app, mode) {
    app.filterMode = mode;
    await saveSimpleState('filterMode', mode);
    await queueAndAttemptSyncOperation({ type: 'simpleUpdate', key: 'filterMode', value: mode });
}

export async function loadFilterMode() {
    const { value: mode } = await loadSimpleState('filterMode');
    return mode || 'unread';
}
