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
} from './dataUtils.js';
import {
    createStatusBarMessage,
    displayTemporaryMessageInTitle
} from '../ui/uiUpdaters.js';
import {
    getShuffleCountDisplay
} from '../ui/uiElements.js';

const MAX_DECK_SIZE = 10;

// This function manages the daily deck of news items.
// It is called with the main application object as a parameter.
// It uses the items already loaded into the app object's state.
export const manageDailyDeck = async (app) => {
    // We are now directly using the `app.entries` array, which should have been
    // populated by the feed sync process before this function is called.
    const allItems = app.entries;
    const hiddenGuids = app.hidden;
    const starredGuids = app.starred;
    const shuffledOutGuids = app.shuffledOutGuids;

    // Log the correct counts to verify the fix
    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuids.length}`);
    console.log(`[deckManager] DEBUG: starredGuids count: ${starredGuids.length}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuids.length}`);

    // If it's a new day or the user has reshuffled, create a new deck.
    const lastResetDate = app.lastShuffleResetDate;
    const today = new Date().toDateString();

    if (lastResetDate !== today || app.shuffleCount > 0) {
        // Filter out hidden and shuffled items from the main feed.
        const deck = allItems.filter(item => !hiddenGuids.includes(item.guid) && !shuffledOutGuids.includes(item.guid));

        // Sort items (if needed) and slice to a manageable size.
        // For now, let's just use the filtered deck.
        app.deck = deck;

        // Save the GUIDs of the new deck to the database.
        await saveCurrentDeck(app.deck.map(item => item.guid));
    }

    console.log(`[deckManager] Deck managed. New deck size: ${app.deck.length}.`);
};

// This function processes a shuffle request from the user.
// It adds the current deck's items to a "shuffled out" list,
// decrements the shuffle count, and triggers a new deck to be built.
export async function processShuffle(app) {
    console.log("[deckManager] processShuffle called.");

    // Check if shuffles are available
    if (app.shuffleCount <= 0) {
        createStatusBarMessage('No shuffles left for today!', 'error');
        return;
    }

    // Get GUIDs of currently visible items in the deck
    const visibleGuids = app.deck.map(item => item.guid);

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
