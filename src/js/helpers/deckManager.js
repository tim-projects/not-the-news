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
 * @param {object} app The main application object.
 */
export const manageDailyDeck = async (app) => {
    // Defensive checks to ensure all necessary data is in a valid state.
    if (!Array.isArray(app.entries) || app.entries.length === 0) {
        console.log('[deckManager] Skipping deck management: app.entries is empty.');
        return;
    }

    // Standardize data arrays to handle potential inconsistencies.
    const allItems = app.entries;
    const hiddenItems = Array.isArray(app.hidden) ? app.hidden : [];
    const starredItems = Array.isArray(app.starred) ? app.starred : [];
    const shuffledOutItems = Array.isArray(app.shuffledOutGuids) ? app.shuffledOutGuids : [];
    const currentDeckItems = Array.isArray(app.currentDeckGuids) ? app.currentDeckGuids : [];

    // Business logic operates on GUIDs. Extract them into Sets for efficient lookups.
    const hiddenGuidsSet = new Set(hiddenItems.map(getGuid));
    const starredGuidsSet = new Set(starredItems.map(getGuid));
    const shuffledOutGuidsSet = new Set(shuffledOutItems.map(getGuid));
    const currentDeckGuidsSet = new Set(currentDeckItems.map(getGuid));

    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuidsSet.size}`);
    
    const today = new Date().toDateString();
    const isNewDay = app.lastShuffleResetDate !== today;

    // --- START: FIX ---
    // The original `isDeckEmpty` check was flawed. It didn't account for items
    // being hidden after the deck was created. This new logic checks if the
    // deck is *effectively* empty from the user's perspective.
    const visibleItemsInCurrentDeck = currentDeckItems.filter(item => !hiddenGuidsSet.has(getGuid(item)));
    const isDeckEffectivelyEmpty = visibleItemsInCurrentDeck.length === 0;
    // --- END: FIX ---

    // Use the new, smarter variable in the condition
    if (isNewDay || isDeckEffectivelyEmpty || app.filterMode !== 'unread') {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Deck Effectively Empty (${isDeckEffectivelyEmpty}), or Filter Mode Changed (${app.filterMode}).`);

        const newDeckItems = await generateNewDeck(
            allItems,
            hiddenItems,
            starredItems,
            shuffledOutItems,
            currentDeckItems,
            MAX_DECK_SIZE,
            app.filterMode
        );

        const timestamp = new Date().toISOString();
        app.currentDeckGuids = (newDeckItems || []).map(item => ({
            guid: item.guid,
            addedAt: timestamp
        }));

        app.deck = (newDeckItems || []).map(item => ({
            ...item,
            isHidden: hiddenGuidsSet.has(item.guid),
            isStarred: starredGuidsSet.has(item.guid)
        }));
        
        await saveCurrentDeck(app.currentDeckGuids);

        if (isNewDay) {
            app.shuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', []);
            app.shuffleCount = DAILY_SHUFFLE_LIMIT;
            await saveShuffleState(app.shuffleCount, today);
            app.lastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        }
    } else {
        console.log(`[deckManager] Retaining existing deck. Visible items: ${visibleItemsInCurrentDeck.length}.`);

        app.deck = allItems
            .filter(item => currentDeckGuidsSet.has(item.guid))
            .map(item => ({
                ...item,
                isHidden: hiddenGuidsSet.has(item.guid),
                isStarred: starredGuidsSet.has(item.guid)
            }));
    }

    console.log(`[deckManager] Deck management complete. Final deck size: ${app.deck.length}.`);
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
    const existingShuffledGuids = (app.shuffledOutGuids || []).map(getGuid);
    
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuids, ...visibleGuids]);
    
    // Convert the combined set of GUIDs back to an array of objects with the correct timestamp.
    const timestamp = new Date().toISOString();
    app.shuffledOutGuids = Array.from(updatedShuffledGuidsSet).map(guid => ({
        guid,
        shuffledAt: timestamp
    }));

    app.shuffleCount--;

    // Persist the new state.
    await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
    await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate);

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    await manageDailyDeck(app);

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}