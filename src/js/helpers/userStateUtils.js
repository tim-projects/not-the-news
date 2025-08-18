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

export async function pruneStaleHidden(feedItems, hiddenItems, currentTS) {
    if (!Array.isArray(hiddenItems)) return [];
    if (!Array.isArray(feedItems) || feedItems.length === 0) return hiddenItems;

    const validFeedGuids = new Set(feedItems.filter(e => e && e.guid).map(e => e.guid.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    return hiddenItems.filter(item => {
        if (!item || !item.guid) return false;

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

export async function loadAndPruneHiddenItems(feedItems) {
    const { value: rawItems } = await loadArrayState('hidden');
    
    // FINAL FIX: Implement a universally robust sanitization and normalization pipeline.
    // This logic handles any mix of strings, objects, nulls, or undefined values.
    let normalizedItems = [];
    if (Array.isArray(rawItems)) {
        for (const item of rawItems) {
            let guid = null;
            let hiddenAt = new Date().toISOString();

            if (typeof item === 'string' && item) {
                guid = item;
            } else if (typeof item === 'object' && item !== null && typeof item.guid === 'string' && item.guid) {
                guid = item.guid;
                // Preserve original timestamp if it's valid
                const ts = new Date(item.hiddenAt).getTime();
                if (!isNaN(ts)) {
                    hiddenAt = item.hiddenAt;
                }
            }

            // Only add the item if we were able to extract a valid GUID.
            if (guid) {
                normalizedItems.push({ guid, hiddenAt });
            }
        }
    }

    const prunedItems = await pruneStaleHidden(feedItems, normalizedItems, Date.now());

    // Determine if the original data was dirty or in the old format.
    const originalLength = Array.isArray(rawItems) ? rawItems.length : 0;
    const needsResave = prunedItems.length !== originalLength || normalizedItems.length !== originalLength;

    if (needsResave) {
        try {
            await saveArrayState('hidden', prunedItems);
            console.log(`Sanitized, pruned, or migrated hidden items. Original count: ${originalLength}, New count: ${prunedItems.length}`);
        } catch (error) {
            console.error("Error saving pruned hidden items:", error);
        }
    }

    return prunedItems;
}

export async function loadCurrentDeck() {
    const { value: storedObjects } = await loadArrayState('currentDeckGuids');
    
    const deckGuids = Array.isArray(storedObjects)
        ? storedObjects.map(item => item.guid).filter(guid => typeof guid === 'string' && guid)
        : [];
        
    console.log(`[loadCurrentDeck] Processed ${deckGuids.length} GUIDs.`);
    return deckGuids;
}

export async function saveCurrentDeck(guids) {
    if (!Array.isArray(guids)) {
         console.error("[saveCurrentDeck] Invalid input: expected an array.");
         return;
    }
    
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
        console.error("[saveCurrentDeck] An error occurred while saving the deck:", e);
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