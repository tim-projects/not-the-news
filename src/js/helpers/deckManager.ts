import {
    saveSimpleState,
    saveArrayState
} from '../data/database.js';
import {
    saveCurrentDeck,
    saveShuffleState
} from './userStateUtils.ts';
import { generateNewDeck } from './dataUtils.ts';
import { AppState, MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem } from '@/types/app.ts';
import {
    createStatusBarMessage,
    displayTemporaryMessageInTitle
} from '../ui/uiUpdaters.ts';
import {
    getShuffleCountDisplay
} from '../ui/uiElements.js';

const DAILY_SHUFFLE_LIMIT = 2;

/**
 * Helper to safely extract GUID from either a string or an object.
 * This ensures backward compatibility during data migration.
 * @param {string|object} item The item to extract a GUID from.
 * @returns {string} The GUID.
 */
const getGuid = (item: string | { guid: string }): string => {
    if (typeof item === 'object' && item.guid) {
        return item.guid;
    }
    return item as string;
};

/**
 * Manages the daily deck of news items.
 * @param {MappedFeedItem[]} entries Array of all feed entries
 * @param {ReadItem[]} readItems Array of read items
 * @param {StarredItem[]} starredItems Array of starred items
 * @param {DeckItem[]} shuffledOutItems Array of shuffled out items
 * @param {number} shuffleCount Current shuffle count
 * @param {string} filterMode Current filter mode (optional, defaults to 'unread')
 * @param {string | null} lastShuffleResetDate Last shuffle reset date (optional)
 * @returns {Promise<{ deck: MappedFeedItem[]; currentDeckGuids: DeckItem[]; shuffledOutGuids: DeckItem[]; shuffleCount: number; lastShuffleResetDate: string; }>} Updated deck state
 */
export const manageDailyDeck = async (
    entries: MappedFeedItem[],
    readItems: ReadItem[],
    starredItems: StarredItem[],
    shuffledOutItems: ShuffledOutItem[],
    shuffleCount: number,
    filterMode: string = 'unread',
    lastShuffleResetDate: string | null = null
): Promise<{ deck: MappedFeedItem[]; currentDeckGuids: DeckItem[]; shuffledOutGuids: ShuffledOutItem[]; shuffleCount: number; lastShuffleResetDate: string; }> => {
    console.log('manageDailyDeck: START');
    console.log('manageDailyDeck: Input params:', { entriesCount: entries.length, readItemsCount: readItems.length, starredItemsCount: starredItems.length, shuffledOutItemsCount: shuffledOutItems.length, shuffleCount, filterMode, lastShuffleResetDate });
    console.log('[deckManager] DEBUG: Array.isArray(entries):', Array.isArray(entries), 'entries.length:', entries.length);
    console.log('[deckManager] DEBUG: Array.isArray(entries):', Array.isArray(entries), 'entries.length:', entries.length);

    // Defensive checks to ensure all necessary data is in a valid state.
    if (!Array.isArray(entries) || entries.length === 0) {
        console.log('[deckManager] Skipping deck management: entries is empty.');
        console.log('manageDailyDeck: END (skipped)');
        return {
            deck: [],
            currentDeckGuids: [],
            shuffledOutGuids: Array.isArray(shuffledOutItems) ? shuffledOutItems : [],
            shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : DAILY_SHUFFLE_LIMIT,
            lastShuffleResetDate: typeof lastShuffleResetDate === 'string' ? lastShuffleResetDate : new Date().toDateString()
        };
    }

    // Standardize data arrays to handle potential inconsistencies.
    const allItems = entries;
    const readItemsArray = Array.isArray(readItems) ? readItems : [];
    const starredItemsArray = Array.isArray(starredItems) ? starredItems : [];
    const shuffledOutItemsArray = Array.isArray(shuffledOutItems) ? shuffledOutItems : [];
    
    // Load current deck from storage
    const { loadCurrentDeck } = await import('./userStateUtils.ts');
    const currentDeckItems = await loadCurrentDeck();
    console.log('manageDailyDeck: Loaded currentDeckItems count:', currentDeckItems.length);

    // Business logic operates on GUIDs. Extract them into Sets for efficient lookups.
    const readGuidsSet = new Set(readItemsArray.map(getGuid));
    const starredGuidsSet = new Set(starredItemsArray.map(getGuid));
    // Removed unused shuffledOutGuidsSet and currentDeckGuidsSet

    const today = new Date().toDateString();
    const isNewDay = lastShuffleResetDate !== today;
    
    // REFINED: A deck is effectively empty if it has no items OR if all items in it have been read.
    const isDeckEmpty = !currentDeckItems || currentDeckItems.length === 0;
    const allItemsInDeckRead = !isDeckEmpty && currentDeckItems.every(item => readGuidsSet.has(getGuid(item)));
    const isDeckEffectivelyEmpty = isDeckEmpty || allItemsInDeckRead;

    let newDeck: MappedFeedItem[] = [];
    let newCurrentDeckGuids: DeckItem[] = currentDeckItems;
    let newShuffledOutGuids: ShuffledOutItem[] = shuffledOutItemsArray;
    let newShuffleCount: number = shuffleCount || DAILY_SHUFFLE_LIMIT;
    let newLastShuffleResetDate: string = lastShuffleResetDate || today;

    // Use the new, smarter variable in the condition
    console.log('manageDailyDeck: Condition check:', { isNewDay, isDeckEffectivelyEmpty, filterModeIsNotUnread: filterMode !== 'unread', entriesCount: entries.length });
    
    // CRITICAL FIX: If the deck is empty but we HAVE entries, we MUST generate a new deck, 
    // especially after a reset.
    if (isNewDay || isDeckEffectivelyEmpty || filterMode !== 'unread') {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Deck Effectively Empty (${isDeckEffectivelyEmpty}), or Filter Mode Changed (${filterMode}).`);

        const newDeckItems = await generateNewDeck(
            allItems,
            readItemsArray,
            starredItemsArray,
            shuffledOutItemsArray,
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
            isRead: readGuidsSet.has(item.guid),
            isStarred: starredGuidsSet.has(item.guid)
        }));
        
        await saveCurrentDeck(newCurrentDeckGuids);

        if (isNewDay) {
            newShuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', []);
            newShuffleCount = DAILY_SHUFFLE_LIMIT;
            await saveShuffleState(newShuffleCount, today as string);
            newLastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        } else if (isDeckEffectivelyEmpty && filterMode === 'unread') {
            // Increment shuffle count when deck is exhausted, up to DAILY_SHUFFLE_LIMIT
            newShuffleCount = Math.min(newShuffleCount + 1, DAILY_SHUFFLE_LIMIT);
            await saveShuffleState(newShuffleCount, lastShuffleResetDate ?? new Date().toDateString());
        }
    }

    console.log(`[deckManager] Deck management complete. Final deck size: ${newDeck.length}.`);
    console.log('manageDailyDeck: END');
    
    return {
        deck: newDeck || [],
        currentDeckGuids: newCurrentDeckGuids || [],
        shuffledOutGuids: newShuffledOutGuids || [],
        shuffleCount: typeof newShuffleCount === 'number' ? newShuffleCount : DAILY_SHUFFLE_LIMIT,
        lastShuffleResetDate: typeof newLastShuffleResetDate === 'string' ? newLastShuffleResetDate : new Date().toDateString()
    };
};

/**
 * Legacy wrapper function that accepts the app object (for backward compatibility)
 * @param {AppState} app The main application object.
 */
export const manageDailyDeckLegacy = async (app: AppState): Promise<void> => {
    const result = await manageDailyDeck(
        app.entries,
        app.read,
        app.starred, 
        app.shuffledOutGuids, // Assuming app.shuffledOutItems is always DeckItem[]
        app.shuffleCount,
        app.filterMode,
        app.lastShuffleResetDate
    );
    
    // Update the app object with the results
    app.deck = result.deck;
    app.currentDeckGuids = result.currentDeckGuids;
    app.shuffledOutGuids = result.shuffledOutGuids;
    app.shuffleCount = result.shuffleCount;
    app.lastShuffleResetDate = result.lastShuffleResetDate;
};

/**
 * Processes a shuffle request from the user.
 * @param {AppState} app The main application object.
 */
export async function processShuffle(app: AppState): Promise<void> {
    console.log("[deckManager] processShuffle called.");

    if (app.shuffleCount <= 0) {
        createStatusBarMessage(app, 'No shuffles left for today!');
        return;
    }

    const visibleGuids = app.deck.map(item => item.guid);
    const existingShuffledGuids: ShuffledOutItem[] = (app.shuffledOutGuids || []).map(getGuid).map(guid => ({ guid, shuffledAt: new Date().toISOString() }));
    
    const existingShuffledGuidsSet = new Set(existingShuffledGuids.map(getGuid));
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuidsSet, ...visibleGuids]);
    
    // Convert the combined set of GUIDs back to an array of objects with the correct timestamp.
    const timestamp = new Date().toISOString();
    const newShuffledOutGuids: ShuffledOutItem[] = Array.from(updatedShuffledGuidsSet).map(guid => ({
        guid,
        shuffledAt: timestamp
    }));

    app.shuffledOutGuids = newShuffledOutGuids;
    app.shuffleCount--;

    // Persist the new state.
    await saveArrayState('shuffledOutGuids', newShuffledOutGuids);
    await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate ?? new Date().toDateString());

    const shuffleDisplay = getShuffleCountDisplay();
    if (shuffleDisplay) {
        shuffleDisplay.textContent = app.shuffleCount.toString(); // textContent expects string
    }

    // Use the new manageDailyDeck function
    const result = await manageDailyDeck(
        app.entries,
        app.read,
        app.starred,
        app.shuffledOutGuids,
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