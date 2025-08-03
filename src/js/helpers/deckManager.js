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
    // The main app.js file should handle the initial loading, but these checks
    // act as a final safety net before critical operations.
    const allItems = Array.isArray(app.entries) ? app.entries : [];

    if (allItems.length === 0) {
        console.log('[deckManager] Skipping deck management: allItems is empty.');
        return;
    }
    
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
            .filter(item => newDeckGuids.includes(item.guid))
            .map(item => ({
                ...item,
                isHidden: hiddenGuidsSet.has(item.guid),
                isStarred: starredGuidsSet.has(item.guid)
            }));
        
        // --- FIX: saveCurrentDeck now correctly receives an array of GUIDs. ---
        await saveCurrentDeck(app.currentDeckGuids);
        
        if (isNewDay) {
            app.shuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', app.shuffledOutGuids);
            
            app.shuffleCount = DAILY_SHUFFLE_LIMIT; // Reset the count
            await saveShuffleState(app.shuffleCount, today); // Save the new count and date

            app.lastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        }
    } else {
        console.log(`[deckManager] Retaining existing deck. Deck size: ${currentDeckGuids.length}.`);
        
        // DEBUG: Add detailed logging to understand the mismatch
        console.log(`[deckManager] DEBUG: currentDeckGuids:`, currentDeckGuids.slice(0, 3)); // First 3 GUIDs
        console.log(`[deckManager] DEBUG: sample allItems GUIDs:`, allItems.slice(0, 3).map(item => item.guid)); // First 3 item GUIDs
        console.log(`[deckManager] DEBUG: allItems[0] full object:`, allItems[0]); // See the structure
        
        // Check if any currentDeckGuids match any allItems IDs
        const matchingItems = allItems.filter(item => currentDeckGuids.includes(item.guid));
        console.log(`[deckManager] DEBUG: Found ${matchingItems.length} matching items out of ${currentDeckGuids.length} deck GUIDs`);
        
        if (matchingItems.length === 0 && currentDeckGuids.length > 0) {
            console.log(`[deckManager] ERROR: No matching items found! This suggests a GUID mismatch.`);
            console.log(`[deckManager] DEBUG: First deck GUID: "${currentDeckGuids[0]}" (type: ${typeof currentDeckGuids[0]})`);
            console.log(`[deckManager] DEBUG: First item GUID: "${allItems[0]?.guid}" (type: ${typeof allItems[0]?.guid})`);
            
            // Try to find the item by checking if GUIDs exist as keys in feedItems
            if (app.feedItems && app.feedItems[currentDeckGuids[0]]) {
                console.log(`[deckManager] DEBUG: Found GUID in feedItems! Structure:`, Object.keys(app.feedItems[currentDeckGuids[0]]));
            } else {
                console.log(`[deckManager] DEBUG: GUID not found in feedItems either.`);
            }
        }
        
        app.deck = allItems
            .filter(item => currentDeckGuids.includes(item.guid))
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