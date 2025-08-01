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

export async function manageDailyDeck(app) {
    console.log("[deckManager] manageDailyDeck called.");

    let {
        shuffleCount: currentShuffleCount,
        lastShuffleResetDate: lastResetDate
    } = await loadShuffleState();
    let {
        value: shuffledOutGuidsArray
    } = await loadArrayState('shuffledOutGuids');

    shuffledOutGuidsArray = Array.isArray(shuffledOutGuidsArray) ? shuffledOutGuidsArray : [];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let newShuffleCount = currentShuffleCount;
    let newShuffledOutGuids = [...shuffledOutGuidsArray];

    const isNewDay = !lastResetDate || new Date(lastResetDate).toDateString() !== today.toDateString();

    if (isNewDay) {
        console.log(`[deckManager] New day detected (${today.toDateString()}). Resetting shuffle state.`);
        newShuffledOutGuids = [];
        newShuffleCount = 2;
        lastResetDate = today;

        await saveShuffleState(newShuffleCount, lastResetDate);
        await saveArrayState('shuffledOutGuids', newShuffledOutGuids);

        app.shuffleCount = newShuffleCount;
        app.shuffledOutGuids = newShuffledOutGuids;
        console.log(`[deckManager] Shuffle count reset to ${app.shuffleCount}, shuffled-out GUIDs cleared.`);
    } else {
        app.shuffleCount = newShuffleCount;
        app.shuffledOutGuids = newShuffledOutGuids;
        console.log(`[deckManager] Same day (${today.toDateString()}). Current shuffle count: ${app.shuffleCount}.`);
    }

    const allItems = await getAllFeedItems();
    const hiddenGuidsSet = new Set(app.hidden.map(h => h.id));
    const starredGuidsSet = new Set(app.starred.map(s => s.id));
    const currentDeckGuidsSet = new Set(app.currentDeckGuids);
    const shuffledOutGuidsSet = new Set(app.shuffledOutGuids);

    // --- START DEBUG LOGS ---
    console.log(`[deckManager] DEBUG: allItems count: ${allItems.length}`);
    console.log(`[deckManager] DEBUG: hiddenGuids count: ${hiddenGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: starredGuids count: ${starredGuidsSet.size}`);
    console.log(`[deckManager] DEBUG: shuffledOutGuids count: ${shuffledOutGuidsSet.size}`);
    // --- END DEBUG LOGS ---

    let newDeckGuids = await generateNewDeck(
        allItems,
        hiddenGuidsSet,
        starredGuidsSet,
        shuffledOutGuidsSet,
        currentDeckGuidsSet,
        MAX_DECK_SIZE,
        app.filterMode
    );

    newDeckGuids = newDeckGuids.filter(guid => typeof guid === 'string' && guid.trim() !== '');

    app.currentDeckGuids = newDeckGuids;
    await saveCurrentDeck(newDeckGuids);

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount;
    }

    console.log(`[deckManager] Deck managed. New deck size: ${app.currentDeckGuids.length}.`);
}

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
