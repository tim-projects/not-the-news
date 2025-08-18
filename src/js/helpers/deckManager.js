// @filepath: src/js/helpers/deckManager.js

// Refactored JS: concise, modern, functional, same output.
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
const DAILY_SHUFFLE_LIMIT = 2; // Added a constant for the daily limit.

/**
 * Manages the daily deck of news items.
 * @param {object} app The main application object.
 */
export const manageDailyDeck = async (app) => {
    // Defensive checks to ensure all necessary data is in a valid state.
    const allItems = Array.isArray(app.entries) ? app.entries : [];

    if (allItems.length === 0) {
        console.log('[deckManager] Skipping deck management: allItems is empty.');
        return;
    }

    const hiddenItems = Array.isArray(app.hidden) ? app.hidden : [];
    const starredItems = Array.isArray(app.starred) ? app.starred : [];
    const shuffledOutGuids = Array.isArray(app.shuffledOutGuids) ? app.shuffledOutGuids : [];
    const currentDeckGuids = Array.isArray(app.currentDeckGuids) ? app.currentDeckGuids : [];

    // FIX: Make this resilient to both old (string array) and new (object array) data formats.
    // This handles the data migration period where the app state might still hold the old format.
    // If the item is an object, get its .guid property. If it's a string, use the string itself.
    const hiddenGuidsSet = new Set(hiddenItems.map(item => (typeof item === 'object' && item.guid ? item.guid : item)));
    const starredGuidsSet = new Set(starredItems.map(item => (typeof item === 'object' && item.guid ? item.guid : item)));
    const shuffledOutGuidsSet = new Set(shuffledOutGuids.map(item => (typeof item === 'object' && item.guid ? item.guid : item)));

    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuidsSet.size}`);

    const today = new Date().toDateString();
    const isNewDay = app.lastShuffleResetDate !== today;
    const isDeckEmpty = currentDeckGuids.length === 0;

    if (isNewDay || isDeckEmpty || app.filterMode !== 'unread') {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Empty Deck (${isDeckEmpty}), or Filter Mode Changed (${app.filterMode}).`);

        const newDeckGuids = await generateNewDeck(
            allItems,
            Array.from(hiddenGuidsSet),
            Array.from(starredGuidsSet),
            Array.from(shuffledOutGuidsSet),
            currentDeckGuids,
            MAX_DECK_SIZE,
            app.filterMode
        );

        // Update the app state with the new deck and its GUIDs.
        app.currentDeckGuids = newDeckGuids || []; // Ensure it's an array

        app.deck = allItems
            .filter(item => app.currentDeckGuids.includes(item.guid))
            .map(item => ({
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
        console.log(`[deckManager] Retaining existing deck. Deck size: ${currentDeckGuids.length}.`);

        // DEBUG: Add detailed logging to understand the mismatch
        console.log(`[deckManager] DEBUG: currentDeckGuids:`, currentDeckGuids.slice(0, 3));
        console.log(`[deckManager] DEBUG: sample allItems GUIDs:`, allItems.slice(0, 3).map(item => item.guid));
        
        const matchingItems = allItems.filter(item => currentDeckGuids.includes(item.guid));
        console.log(`[deckManager] DEBUG: Found ${matchingItems.length} matching items out of ${currentDeckGuids.length} deck GUIDs`);

        app.deck = matchingItems.map(item => ({
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
    
    // FIX: Normalize the existing shuffled GUIDs before adding to the Set.
    const existingShuffledGuids = app.shuffledOutGuids.map(item => (typeof item === 'object' && item.guid ? item.guid : item));
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuids, ...visibleGuids]);

    // Convert back to the correct object format for saving and state consistency.
    app.shuffledOutGuids = Array.from(updatedShuffledGuidsSet).map(guid => ({ guid }));
    app.shuffleCount--;

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