// @filepath: src/js/helpers/deckManager.js

// Refactored JS: concise, modern, functional, same output.
import {
    loadSimpleState,
    saveSimpleState,
    loadArrayState,
    saveArrayState,
    getAllFeedItems
} from '../data/database.js';
import {
    saveCurrentDeck,
    loadShuffleState,
    saveShuffleState
} from './userStateUtils.js';
import {
    generateNewDeck
} from './dataUtils.js'; // This is now being used
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
    if (!Array.isArray(app.entries)) {
        console.warn("[deckManager] app.entries is not an array. Initializing to empty array.");
        app.entries = [];
    }

    if (!Array.isArray(app.hidden)) {
        console.warn("[deckManager] app.hidden is not an array. Initializing to empty array.");
        app.hidden = [];
    }
    
    if (!Array.isArray(app.shuffledOutGuids)) {
        console.warn("[deckManager] app.shuffledOutGuids is not an array. Initializing to empty array.");
        app.shuffledOutGuids = [];
    }
    
    const allItems = app.entries;
    
    // Create Sets for efficient lookups of hidden and shuffled-out GUIDs.
    const hiddenGuids = new Set(app.hidden.map(item => item.guid));
    const shuffledOutGuids = new Set(app.shuffledOutGuids);

    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuids.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuids.size}`);
    
    // Check if the current deck needs to be generated or regenerated.
    const today = new Date().toDateString();
    const isNewDay = app.lastShuffleResetDate !== today;
    const isDeckEmpty = app.currentDeckGuids.length === 0;

    // The condition for generating a new deck has been corrected and simplified.
    // A new deck is generated if it's a new day, or if the current deck is empty.
    if (isNewDay || isDeckEmpty) {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}) or Empty Deck (${isDeckEmpty}).`);
        
        // Filter out hidden and shuffled items from the main feed.
        const availableItems = allItems.filter(item => 
            !hiddenGuids.has(item.id) && !shuffledOutGuids.has(item.id)
        );
        
        // Use the imported helper function to generate a new deck.
        const newDeck = generateNewDeck(availableItems, MAX_DECK_SIZE);

        // Update the app state with the new deck and its GUIDs.
        app.deck = newDeck;
        app.currentDeckGuids = newDeck.map(item => item.id);
        
        // Save the new deck GUIDs to the database.
        await saveCurrentDeck(app.currentDeckGuids);
        
        // Reset shuffled-out items and shuffle count for the new day.
        if (isNewDay) {
            app.shuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
            
            // Set a new lastShuffleResetDate
            app.lastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        }
        
    } else {
        // If it's not a new day and the deck isn't empty, just load the existing deck.
        console.log(`[deckManager] Retaining existing deck. Deck size: ${app.currentDeckGuids.length}.`);
        const starredGuids = new Set(app.starred.map(item => item.guid));
        app.deck = allItems
            .filter(item => app.currentDeckGuids.includes(item.id))
            .map(item => ({
                ...item,
                isHidden: hiddenGuids.has(item.id),
                isStarred: starredGuids.has(item.id)
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

    // Get GUIDs of currently visible items in the deck
    const visibleGuids = app.deck.map(item => item.id);

    // Add these GUIDs to the shuffled-out list, ensuring uniqueness.
    const updatedShuffledOutGuids = new Set([...app.shuffledOutGuids, ...visibleGuids]);
    app.shuffledOutGuids = Array.from(updatedShuffledOutGuids);

    app.shuffleCount--;

    // Save the updated shuffled-out GUIDs and shuffle count to IndexedDB
    await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
    
    // Save current shuffle count and reset date
    await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate);

    // Update the UI display for shuffle count immediately
    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    // Trigger a re-evaluation of the deck by calling manageDailyDeck
    await manageDailyDeck(app);

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}