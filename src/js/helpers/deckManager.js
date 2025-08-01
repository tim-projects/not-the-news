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
// This ensures it has access to the most up-to-date state (like hidden and starred items).
export const manageDailyDeck = async (app) => {
    // We are now using the app.hidden and app.starred arrays directly, which were
    // correctly populated by the loadAndManageData function.
    const allItems = await app.getFeedItemsFromDB();
    const hiddenGuids = app.hidden;
    const starredGuids = app.starred;
    const shuffledOutGuids = app.shuffledOutGuids;
    
    // Log the correct counts to verify the fix
    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuids.length}`);
    console.log(`[deckManager] DEBUG: starredGuids count: ${starredGuids.length}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuids.length}`);

    // If it's a new day or the user has reshuffled, create a new deck.
    // The previous error occurred because this function was not using the correct hidden/starred counts.
    const lastResetDate = app.lastShuffleResetDate;
    const today = new Date().toDateString();

    if (lastResetDate !== today || app.shuffleCount > 0) {
        // ... rest of your deck generation logic here ...
        // Filter out hidden and shuffled items from the main feed.
        const deck = allItems.filter(item => !hiddenGuids.includes(item.guid) && !shuffledOutGuids.includes(item.guid));

        // Sort items (if needed) and slice to a manageable size.
        // For now, let's just use the filtered deck.
        app.deck = deck;

        // Save the new deck to the database.
        await saveCurrentDeck(app.deck);
    }

    console.log(`[deckManager] Deck managed. New deck size: ${app.deck.length}.`);
};
export async function processShuffle(app) {
    // ... (rest of the function is unchanged)
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
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await saveShuffleState(app.shuffleCount, today);

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    await manageDailyDeck(app);

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);
}
