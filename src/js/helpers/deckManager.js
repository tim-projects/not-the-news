// www/js/helpers/deck-manager.js

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
} from './dataUtils.js'; // The refactored loadNextDeck
import {
    createStatusBarMessage,
    displayTemporaryMessageInTitle
} from '../ui/uiUpdaters.js';
import {
    getShuffleCountDisplay
} from '../ui/uiElements.js';

const MAX_DECK_SIZE = 10; // Define the maximum number of items in the deck

/**
 * Orchestrates the daily deck reset and initial deck generation.
 * This function is called at app startup and during background syncs.
 * It determines if a new day has started, resets shuffle-related states,
 * and then generates the current deck based on eligibility rules.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function manageDailyDeck(app) {
    console.log("[deckManager] manageDailyDeck called.");

    // Load current shuffle state and shuffled-out GUIDs
    let {
        shuffleCount: currentShuffleCount,
        lastShuffleResetDate: lastResetDate
    } = await loadShuffleState();
    let {
        value: shuffledOutGuidsArray
    } = await loadArrayState('shuffledOutGuids');

    // Ensure shuffledOutGuidsArray is an array, default to empty if not
    shuffledOutGuidsArray = Array.isArray(shuffledOutGuidsArray) ? shuffledOutGuidsArray : [];


    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize 'today' to midnight for comparison

    let newShuffleCount = currentShuffleCount;
    let newShuffledOutGuids = [...shuffledOutGuidsArray]; // Create a mutable copy

    // Detect if it's a new day
    const isNewDay = !lastResetDate || new Date(lastResetDate).toDateString() !== today.toDateString();

    if (isNewDay) {
        console.log(`[deckManager] New day detected (${today.toDateString()}). Resetting shuffle state.`);
        // Crucially, clear user_state.shuffled_out_guids
        newShuffledOutGuids = [];
        // Reset user_state.shuffleCount
        newShuffleCount = 2; // Reset shuffleCount to 2 for a new day
        // Update user_state.last_reset_date to today's date
        lastResetDate = today;

        // Save these reset changes to IndexedDB
        await saveShuffleState(newShuffleCount, lastResetDate);
        await saveArrayState('shuffledOutGuids', newShuffledOutGuids);

        // Update Alpine.js app state immediately
        app.shuffleCount = newShuffleCount;
        app.shuffledOutGuids = newShuffledOutGuids; // Sync Alpine state
        console.log(`[deckManager] Shuffle count reset to ${app.shuffleCount}, shuffled-out GUIDs cleared.`);
    } else {
        // If it's the same day, ensure Alpine app state reflects loaded values
        app.shuffleCount = newShuffleCount;
        app.shuffledOutGuids = newShuffledOutGuids;
        console.log(`[deckManager] Same day (${today.toDateString()}). Current shuffle count: ${app.shuffleCount}.`);
    }

    // --- Deck Generation Logic (applies to both new day and same day) ---

    // Get all items from local database
    const allItems = await getAllFeedItems();
    // Get current hidden and current deck GUIDs from Alpine app state (which should be up-to-date)
    const hiddenGuidsSet = new Set(app.hidden.map(h => h.id));
    const currentDeckGuidsSet = new Set(app.currentDeckGuids); // Items currently in the displayed deck
    const shuffledOutGuidsSet = new Set(app.shuffledOutGuids); // Items recently shuffled out

    // Call the generic deck generation helper
    const newDeckGuids = generateNewDeck(
        allItems,
        hiddenGuidsSet,
        shuffledOutGuidsSet,
        currentDeckGuidsSet,
        MAX_DECK_SIZE
    );

    // Update the Alpine.js app's currentDeckGuids, which will trigger its $watch
    // and subsequently call app.loadAndDisplayDeck() to update the UI.
    app.currentDeckGuids = newDeckGuids;
    // Save the newly generated deck GUIDs
    await saveCurrentDeck(newDeckGuids);

    // Update the UI display for shuffle count
    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    console.log(`[deckManager] Deck managed. New deck size: ${app.currentDeckGuids.length}.`);
}

/**
 * Handles the logic when the shuffle button is pressed.
 * This function updates the shuffled-out GUIDs, decrements the shuffle count,
 * and then triggers a re-generation of the deck.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function processShuffle(app) {
    console.log("[deckManager] processShuffle called.");

    // Check if shuffles are available
    if (app.shuffleCount <= 0) {
        createStatusBarMessage('No shuffles left for today!', 'error');
        return;
    }

    // Get GUIDs of currently visible items in the deck
    const visibleGuids = app.deck.map(item => item.id);

    // Add these GUIDs to the shuffled_out_guids array in app state
    // Ensure uniqueness and that we're not adding hidden items back to shuffled-out list
    const updatedShuffledOutGuids = new Set([...app.shuffledOutGuids, ...visibleGuids]);
    app.shuffledOutGuids = Array.from(updatedShuffledOutGuids);

    // Decrement shuffleCount
    app.shuffleCount--;

    // Save the updated shuffled-out GUIDs and shuffle count to IndexedDB
    await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize for saving lastShuffleResetDate
    await saveShuffleState(app.shuffleCount, today); // Save current shuffle count and reset date

    // Update the UI display for shuffle count immediately
    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    // Trigger a re-evaluation of the deck by calling manageDailyDeck
    // This will generate a new deck excluding the newly shuffled-out items.
    await manageDailyDeck(app);

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}