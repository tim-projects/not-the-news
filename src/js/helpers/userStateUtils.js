// @filepath: src/js/helpers/userStateUtils.js

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
    
    const actionVerb = stateKey.slice(0, -1); // e.g., 'star' from 'starred'
    const newItem = action === 'add' ? { guid, [`${actionVerb}At`]: timestamp } : null;

    // This now finds by GUID and adds/removes the object internally
    await updateArrayState(stateKey, guid, newItem);

    // Update the local application state to match
    if (action === 'add') {
        app[stateKey] = [...app[stateKey], newItem];
    } else {
        app[stateKey] = app[stateKey].filter(item => item.guid !== guid);
    }
    
    if (stateKey === 'hidden') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unhidden.' : 'Item hidden.', 'info');
    } else if (stateKey === 'starred') {
        createStatusBarMessage(isCurrentlyActive ? 'Item unstarred.' : 'Item starred.', 'info');
    }

    if (typeof app.updateCounts === 'function') app.updateCounts();

    await queueAndAttemptSyncOperation(pendingOp);
}

export async function pruneStaleHidden(feedItems, hiddenItems, currentTS) {
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return hiddenItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    return hiddenItems.filter(item => {
        if (!item || !item.guid) return false;

        const normalizedGuid = String(item.guid).trim().toLowerCase();
        if (validFeedGuids.has(normalizedGuid)) return true;

        // Use the timestamp on the object for pruning logic
        if (item.hiddenAt) {
            const hiddenAtTS = new Date(item.hiddenAt).getTime();
            if (!isNaN(hiddenAtTS)) {
                return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
            }
        }
        // If an item somehow has no timestamp, don't prune it.
        return true; 
    });
}

export async function loadAndPruneHiddenItems(feedItems) {
    const { value: rawItems } = await loadArrayState('hidden');
    let needsResave = false;
    
    // Data migration and normalization logic
    let normalizedItems = [];
    if (Array.isArray(rawItems)) {
        const defaultTimestamp = new Date().toISOString();
        for (const item of rawItems) {
            if (typeof item === 'string' && item) {
                // Legacy string data: migrate to object
                normalizedItems.push({ guid: item, hiddenAt: defaultTimestamp });
                needsResave = true;
            } else if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid) {
                // Modern object data: ensure timestamp exists
                if (!item.hiddenAt) {
                    item.hiddenAt = defaultTimestamp;
                    needsResave = true;
                }
                normalizedItems.push(item);
            }
        }
    }

    const prunedItems = await pruneStaleHidden(feedItems, normalizedItems, Date.now());

    if (prunedItems.length !== normalizedItems.length) {
        needsResave = true;
    }

    if (needsResave) {
        try {
            await saveArrayState('hidden', prunedItems);
            console.log(`Sanitized, pruned, or migrated hidden items. Original count: ${rawItems.length}, New count: ${prunedItems.length}`);
        } catch (error) {
            console.error("Error saving pruned hidden items:", error);
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

export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array of GUIDs.");
         return;
    }
    
    const validGuids = guids.filter(g => typeof g === 'string' && g);

    if (validGuids.length !== guids.length) {
        console.warn("[saveCurrentDeck] Filtered out invalid GUIDs from the generated deck.");
    }

    console.log("[saveCurrentDeck] Saving", validGuids.length, "GUIDs.");

    try {
        // Convert GUIDs to full objects with timestamps
        const timestamp = new Date().toISOString();
        const deckObjects = validGuids.map(guid => ({ guid, addedAt: timestamp }));

        await saveArrayState('currentDeckGuids', deckObjects);

        // Sync operation sends the full objects as well
        await queueAndAttemptSyncOperation({
            type: 'simpleUpdate',
            key: 'currentDeckGuids',
            value: deckObjects 
        });
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