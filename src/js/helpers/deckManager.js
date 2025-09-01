// @filepath: src/js/helpers/deckManager.js

import {
    saveSimpleState,
    saveArrayState
} from '../data/database.js';
import {
    saveCurrentDeck,
    saveShuffleState
} from './userStateUtils.js';
import {
    generateNewDeck
} from './dataUtils.js';
import {
    createStatusBarMessage,
    displayTemporaryMessageInTitle
} from '../ui/uiUpdaters.js';
import {
    getShuffleCountDisplay
} from '../ui/uiElements.js';

const MAX_DECK_SIZE = 10;
const DAILY_SHUFFLE_LIMIT = 2;

/**
 * Helper to safely extract GUID from either a string or an object.
 * This ensures backward compatibility during data migration.
 * @param {string|object} item The item to extract a GUID from.
 * @returns {string} The GUID.
 */
const getGuid = item => (typeof item === 'object' && item.guid ? item.guid : item);

/**
 * Manages the daily deck of news items.
 * @param {Array} entries Array of all feed entries
 * @param {Array} hiddenItems Array of hidden items
 * @param {Array} starredItems Array of starred items  
 * @param {Array} shuffledOutItems Array of shuffled out items
 * @param {number} shuffleCount Current shuffle count
 * @param {string} filterMode Current filter mode (optional, defaults to 'unread')
 * @param {string} lastShuffleResetDate Last shuffle reset date (optional)
 * @returns {Object} Updated deck state
 */
export const manageDailyDeck = async (entries, hiddenItems, starredItems, shuffledOutItems, shuffleCount, filterMode = 'unread', lastShuffleResetDate = null) => {
    console.log('manageDailyDeck: START');
    console.log('manageDailyDeck: Input params:', { entriesCount: entries.length, hiddenItemsCount: hiddenItems.length, starredItemsCount: starredItems.length, shuffledOutItemsCount: shuffledOutItems.length, shuffleCount, filterMode, lastShuffleResetDate });

    // Defensive checks to ensure all necessary data is in a valid state.
    if (!Array.isArray(entries) || entries.length === 0) {
        console.log('[deckManager] Skipping deck management: entries is empty.');
        console.log('manageDailyDeck: END (skipped)');
        return {
            deck: [],
            currentDeckGuids: [],
            shuffledOutGuids: shuffledOutItems || [],
            shuffleCount: shuffleCount || DAILY_SHUFFLE_LIMIT,
            lastShuffleResetDate: lastShuffleResetDate || new Date().toDateString()
        };
    }

    // Standardize data arrays to handle potential inconsistencies.
    const allItems = entries;
    const hiddenItemsArray = Array.isArray(hiddenItems) ? hiddenItems : [];
    const starredItemsArray = Array.isArray(starredItems) ? starredItems : [];
    const shuffledOutItemsArray = Array.isArray(shuffledOutItems) ? shuffledOutItems : [];
    
    // Load current deck from storage
    const { loadCurrentDeck } = await import('./userStateUtils.js');
    const currentDeckItems = await loadCurrentDeck();
    console.log('manageDailyDeck: Loaded currentDeckItems count:', currentDeckItems.length);

    // Business logic operates on GUIDs. Extract them into Sets for efficient lookups.
    const hiddenGuidsSet = new Set(hiddenItemsArray.map(getGuid));
    const starredGuidsSet = new Set(starredItemsArray.map(getGuid));
    const shuffledOutGuidsSet = new Set(shuffledOutItemsArray.map(getGuid));
    const currentDeckGuidsSet = new Set(currentDeckItems.map(getGuid));

    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: currentDeck count: ${currentDeckItems.length}`);
    
    const today = new Date().toDateString();
    const isNewDay = lastShuffleResetDate !== today;

    // --- START: FIX ---
    // The original `isDeckEmpty` check was flawed. It didn't account for items
    // being hidden after the deck was created. This new logic checks if the
    // deck is *effectively* empty from the user's perspective.
    const visibleItemsInCurrentDeck = currentDeckItems.filter(item => !hiddenGuidsSet.has(getGuid(item)));
    const isDeckEffectivelyEmpty = visibleItemsInCurrentDeck.length === 0;
    console.log('manageDailyDeck: isDeckEffectivelyEmpty:', isDeckEffectivelyEmpty, 'visibleItemsInCurrentDeck count:', visibleItemsInCurrentDeck.length);
    // --- END: FIX ---

    let newDeck = [];
    let newCurrentDeckGuids = currentDeckItems;
    let newShuffledOutGuids = shuffledOutItemsArray;
    let newShuffleCount = shuffleCount || DAILY_SHUFFLE_LIMIT;
    let newLastShuffleResetDate = lastShuffleResetDate || today;

    // Use the new, smarter variable in the condition
    console.log('manageDailyDeck: Condition check:', { isNewDay, isDeckEffectivelyEmpty, filterModeIsNotUnread: filterMode !== 'unread' });
    if (isNewDay || isDeckEffectivelyEmpty || filterMode !== 'unread') {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Deck Effectively Empty (${isDeckEffectivelyEmpty}), or Filter Mode Changed (${filterMode}).`);

        const newDeckItems = await generateNewDeck(
            allItems,
            hiddenItemsArray,
            starredItemsArray,
            shuffledOutItemsArray,
            currentDeckItems,
            MAX_DECK_SIZE,
            filterMode
        );
        console.log('manageDailyDeck: generateNewDeck returned count:', newDeckItems.length);

        const timestamp = new Date().toISOString();
        newCurrentDeckGuids = (newDeckItems || []).map(item => ({
            guid: item.guid,
            addedAt: timestamp
        }));

        newDeck = (newDeckItems || []).map(item => ({
            ...item,
            isHidden: hiddenGuidsSet.has(item.guid),
            isStarred: starredGuidsSet.has(item.guid)
        }));
        
        await saveCurrentDeck(newCurrentDeckGuids);

        if (isNewDay) {
            newShuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', []);
            newShuffleCount = DAILY_SHUFFLE_LIMIT;
            await saveShuffleState(newShuffleCount, today);
            newLastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        } else if (isDeckEffectivelyEmpty && filterMode === 'unread') {
            // Increment shuffle count when deck is exhausted, up to DAILY_SHUFFLE_LIMIT
            newShuffleCount = Math.min(newShuffleCount + 1, DAILY_SHUFFLE_LIMIT);
            await saveShuffleState(newShuffleCount, lastShuffleResetDate);
        }
    } else {
        console.log(`[deckManager] Retaining existing deck. Visible items: ${visibleItemsInCurrentDeck.length}.`);

        newDeck = allItems
            .filter(item => currentDeckGuidsSet.has(item.guid))
            .map(item => ({
                ...item,
                isHidden: hiddenGuidsSet.has(item.guid),
                isStarred: starredGuidsSet.has(item.guid)
            }));
    }

    console.log(`[deckManager] Deck management complete. Final deck size: ${newDeck.length}.`);
    console.log('manageDailyDeck: END');
    
    return {
        deck: newDeck,
        currentDeckGuids: newCurrentDeckGuids,
        shuffledOutGuids: newShuffledOutGuids,
        shuffleCount: newShuffleCount,
        lastShuffleResetDate: newLastShuffleResetDate
    };
};

/**
 * Legacy wrapper function that accepts the app object (for backward compatibility)
 * @param {object} app The main application object.
 */
export const manageDailyDeckLegacy = async (app) => {
    const result = await manageDailyDeck(
        app.entries,
        app.hidden,
        app.starred, 
        app.shuffledOutItems || app.shuffledOutGuids,
        app.shuffleCount,
        app.filterMode,
        app.lastShuffleResetDate
    );
    
    // Update the app object with the results
    app.deck = result.deck;
    app.currentDeckGuids = result.currentDeckGuids;
    app.shuffledOutItems = result.shuffledOutGuids;
    app.shuffleCount = result.shuffleCount;
    app.lastShuffleResetDate = result.lastShuffleResetDate;
};

/**
 * Processes a shuffle request from the user.
 * @param {object} app The main application object.
 */
export async function processShuffle(app) {
    console.log("[deckManager] processShuffle called.");

    if (app.shuffleCount <= 0) {
        createStatusBarMessage('No shuffles left for today!', 'error');
        return;
    }

    const visibleGuids = app.deck.map(item => item.guid);
    const existingShuffledGuids = (app.shuffledOutItems || app.shuffledOutGuids || []).map(getGuid);
    
    const existingShuffledGuidsSet = new Set(existingShuffledGuids);
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuidsSet, ...visibleGuids]);
    
    // Convert the combined set of GUIDs back to an array of objects with the correct timestamp.
    const timestamp = new Date().toISOString();
    const newShuffledOutGuids = Array.from(updatedShuffledGuidsSet).map(guid => ({
        guid,
        shuffledAt: timestamp
    }));

    app.shuffledOutItems = newShuffledOutGuids;
    app.shuffledOutGuids = newShuffledOutGuids; // Maintain backward compatibility
    app.shuffleCount--;

    // Persist the new state.
    await saveArrayState('shuffledOutGuids', newShuffledOutGuids);
    await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate);

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    // Use the new manageDailyDeck function
    const result = await manageDailyDeck(
        app.entries,
        app.hidden,
        app.starred,
        app.shuffledOutItems,
        app.shuffleCount,
        app.filterMode,
        app.lastShuffleResetDate
    );
    
    // Update the app object with the results
    app.deck = result.deck;
    app.currentDeckGuids = result.currentDeckGuids;

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}