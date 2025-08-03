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

/**
 * Manages the daily deck of news items.
 * @param {object} app The main application object.
 */
export const manageDailyDeck = async (app) => {
    // Defensive checks to ensure all necessary data is in a valid state.
    // The main app.js file should handle the initial loading, but these checks
    // act as a final safety net before critical operations.
    const allItems = Array.isArray(app.entries) ? app.entries : [];
    const hiddenItems = Array.isArray(app.hidden) ? app.hidden : [];
    const starredItems = Array.isArray(app.starred) ? app.starred : [];
    const shuffledOutGuids = Array.isArray(app.shuffledOutGuids) ? app.shuffledOutGuids : [];
    const currentDeckGuids = Array.isArray(app.currentDeckGuids) ? app.currentDeckGuids : [];
    
    // Create Sets for efficient lookups.
    const hiddenGuidsSet = new Set(hiddenItems.map(item => item.guid));
    const starredGuidsSet = new Set(starredItems.map(item => item.guid));
    const shuffledOutGuidsSet = new Set(shuffledOutGuids);

    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuidsSet.size}`);
    
    const today = new Date().toDateString();
    const isNewDay = app.lastShuffleResetDate !== today;
    const isDeckEmpty = currentDeckGuids.length === 0;

    if (isNewDay || isDeckEmpty || app.filterMode !== 'unread') {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Empty Deck (${isDeckEmpty}), or Filter Mode Changed (${app.filterMode}).`);

        // Now, we pass all the required data to generateNewDeck.
        // It will handle all the filtering and deck creation logic internally.
        const newDeckGuids = await generateNewDeck(
            allItems,
            hiddenItems.map(item => item.guid),
            starredItems.map(item => item.guid),
            shuffledOutGuids,
            currentDeckGuids,
            MAX_DECK_SIZE,
            app.filterMode
        );

        // Update the app state with the new deck and its GUIDs.
        app.currentDeckGuids = newDeckGuids;
        app.deck = allItems
            .filter(item => newDeckGuids.includes(item.id))
            .map(item => ({
                ...item,
                isHidden: hiddenGuidsSet.has(item.id),
                isStarred: starredGuidsSet.has(item.id)
            }));
        
        await saveCurrentDeck(app.currentDeckGuids);
        
        if (isNewDay) {
            app.shuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
            
            app.lastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        }
    } else {
        console.log(`[deckManager] Retaining existing deck. Deck size: ${currentDeckGuids.length}.`);
        app.deck = allItems
            .filter(item => currentDeckGuids.includes(item.id))
            .map(item => ({
                ...item,
                isHidden: hiddenGuidsSet.has(item.id),
                isStarred: starredGuidsSet.has(item.id)
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

    const visibleGuids = app.deck.map(item => item.id);
    const updatedShuffledOutGuids = new Set([...app.shuffledOutGuids, ...visibleGuids]);
    app.shuffledOutGuids = Array.from(updatedShuffledOutGuids);

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