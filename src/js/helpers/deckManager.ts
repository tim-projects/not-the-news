import {
    saveSimpleState,
    saveArrayState
} from '../data/dbUserState.ts';
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
 * @param {DeckItem[] | null} pregeneratedDeck Optional pre-generated deck to use if available
 * @returns {Promise<{ deck: MappedFeedItem[]; currentDeckGuids: DeckItem[]; shuffledOutGuids: ShuffledOutItem[]; shuffleCount: number; lastShuffleResetDate: string; }>} Updated deck state
 */
export const manageDailyDeck = async (
    entries: MappedFeedItem[],
    readItems: ReadItem[],
    starredItems: StarredItem[],
    shuffledOutItems: ShuffledOutItem[],
    shuffleCount: number,
    filterMode: string = 'unread',
    lastShuffleResetDate: string | null = null,
    pregeneratedDeck: DeckItem[] | null = null
): Promise<{ deck: MappedFeedItem[]; currentDeckGuids: DeckItem[]; shuffledOutGuids: ShuffledOutItem[]; shuffleCount: number; lastShuffleResetDate: string; }> => {
    console.log('manageDailyDeck: START');
    console.log('manageDailyDeck: Input params:', { entriesCount: entries.length, readItemsCount: readItems.length, starredItemsCount: starredItems.length, shuffledOutItemsCount: shuffledOutItems.length, shuffleCount, filterMode, lastShuffleResetDate, hasPregen: !!pregeneratedDeck });

    // Defensive checks to ensure all necessary data is in a valid state.
    if (!Array.isArray(entries) || entries.length === 0) {
        console.log('[deckManager] Skipping deck management: entries is empty.');
        return {
            deck: [],
            currentDeckGuids: [],
            shuffledOutGuids: Array.isArray(shuffledOutItems) ? shuffledOutItems : [],
            shuffleCount: typeof shuffleCount === 'number' ? shuffleCount : DAILY_SHUFFLE_LIMIT,
            lastShuffleResetDate: typeof lastShuffleResetDate === 'string' ? lastShuffleResetDate : new Date().toDateString()
        };
    }

    const readItemsArray = Array.isArray(readItems) ? readItems : [];
    const starredItemsArray = Array.isArray(starredItems) ? starredItems : [];
    const shuffledOutItemsArray = Array.isArray(shuffledOutItems) ? shuffledOutItems : [];
    
    const { loadCurrentDeck } = await import('./userStateUtils.ts');
    const currentDeckItems = await loadCurrentDeck();
    
    const readGuidsSet = new Set(readItemsArray.map(getGuid));
    const starredGuidsSet = new Set(starredItemsArray.map(getGuid));
    const shuffledOutGuidsSet = new Set(shuffledOutItemsArray.map(getGuid));
    
    const entriesMap = new Map(entries.map(e => [e.guid, e]));

    let existingDeck: MappedFeedItem[] = currentDeckItems
        .map(di => entriesMap.get(getGuid(di)))
        .filter((item): item is MappedFeedItem => !!item);

    const today = new Date().toDateString();
    const isNewDay = lastShuffleResetDate !== today;
    
    const isDeckEmpty = !currentDeckItems || currentDeckItems.length === 0 || existingDeck.length === 0;
    const isDeckEffectivelyEmpty = isDeckEmpty || existingDeck.every(item => 
        readGuidsSet.has(item.guid) || shuffledOutGuidsSet.has(item.guid)
    );
    const allItemsInDeckShuffled = !isDeckEmpty && existingDeck.every(item => shuffledOutGuidsSet.has(item.guid));

    let newDeck: MappedFeedItem[] = existingDeck;
    let newCurrentDeckGuids: DeckItem[] = currentDeckItems;
    let newShuffledOutGuids: ShuffledOutItem[] = shuffledOutItemsArray;
    let newShuffleCount: number = (typeof shuffleCount === 'number') ? shuffleCount : DAILY_SHUFFLE_LIMIT;
    let newLastShuffleResetDate: string = lastShuffleResetDate || today;

    if (isNewDay || isDeckEffectivelyEmpty || filterMode !== 'unread' || (currentDeckItems.length === 0 && entries.length > 0)) {
        console.log(`[deckManager] Resetting deck. Reason: New Day (${isNewDay}), Deck Effectively Empty (${isDeckEffectivelyEmpty}), Filter Mode Changed (${filterMode}), or Initial Load (${currentDeckItems.length === 0}).`);

        if (!isNewDay && currentDeckItems.length > 0 && isDeckEffectivelyEmpty && filterMode === 'unread') {
            if (!allItemsInDeckShuffled) {
                console.log('[deckManager] Automatically incrementing (refunding) shuffleCount due to deck cleared by reading.');
                newShuffleCount++;
                await saveShuffleState(newShuffleCount, newLastShuffleResetDate);
            }
        }

        let newDeckItems: any[] = [];

        // Check if we have a usable pre-generated deck
        let usablePregen = false;
        if (pregeneratedDeck && pregeneratedDeck.length > 0) {
            // Verify it's not stale (has at least one unread item)
            const hasUnread = pregeneratedDeck.some(item => !readGuidsSet.has(getGuid(item)));
            if (hasUnread) {
                usablePregen = true;
            } else {
                console.log('[deckManager] Pre-generated deck is stale (all items read). Falling back to manual generation.');
            }
        }

        if (usablePregen && pregeneratedDeck) {
            console.log('[deckManager] Using pre-generated deck inside manageDailyDeck');
            newDeckItems = [...pregeneratedDeck];
            
            // TOP-UP LOGIC: If pregen is small, add more items from scratch
            if (newDeckItems.length < 10) {
                console.log(`[deckManager] Pregen is small (${newDeckItems.length}), topping up to 10.`);
                const topUpItems = await generateNewDeck(
                    entries,
                    readItemsArray,
                    starredItemsArray,
                    [...shuffledOutItemsArray, ...newDeckItems.map(getGuid)],
                    filterMode
                );
                newDeckItems = [...newDeckItems, ...topUpItems].slice(0, 10);
            }
        } else {
            console.log('[deckManager] Generating new deck from scratch inside manageDailyDeck');
            newDeckItems = await generateNewDeck(
                entries,
                readItemsArray,
                starredItemsArray,
                shuffledOutItemsArray,
                filterMode
            );
        }
        
        const timestamp = new Date().toISOString();
        newCurrentDeckGuids = (newDeckItems || []).map(item => ({
            guid: getGuid(item),
            addedAt: timestamp
        }));

        newDeck = (newDeckItems || [])
            .map(item => entriesMap.get(getGuid(item)))
            .filter((item): item is MappedFeedItem => !!item)
            .map(item => ({
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
        }
    } else {
        newDeck = existingDeck.map(item => ({
            ...item,
            isRead: readGuidsSet.has(item.guid),
            isStarred: starredGuidsSet.has(item.guid)
        }));
    }

    return {
        deck: newDeck || [],
        currentDeckGuids: newCurrentDeckGuids || [],
        shuffledOutGuids: newShuffledOutGuids || [],
        shuffleCount: typeof newShuffleCount === 'number' ? newShuffleCount : DAILY_SHUFFLE_LIMIT,
        lastShuffleResetDate: typeof newLastShuffleResetDate === 'string' ? newLastShuffleResetDate : new Date().toDateString()
    };
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
    console.log(`[deckManager] processShuffle: Visible GUIDs to shuffle out: ${visibleGuids.length}`, visibleGuids);
    const existingShuffledGuids: ShuffledOutItem[] = (app.shuffledOutGuids || []).map(getGuid).map(guid => ({ guid, shuffledAt: new Date().toISOString() }));
    
    const existingShuffledGuidsSet = new Set(existingShuffledGuids.map(getGuid));
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuidsSet, ...visibleGuids]);
    
    const timestamp = new Date().toISOString();
    const newShuffledOutGuids: ShuffledOutItem[] = Array.from(updatedShuffledGuidsSet).map(guid => ({
        guid,
        shuffledAt: timestamp
    }));

    app.shuffledOutGuids = newShuffledOutGuids;
    app.shuffleCount--;

    const { overwriteArrayAndSyncChanges } = await import('../data/dbUserState.ts');
    await overwriteArrayAndSyncChanges('shuffledOutGuids', newShuffledOutGuids);
    await saveShuffleState(app.shuffleCount, app.lastShuffleResetDate ?? new Date().toDateString());

    // Use the optimized manageDailyDeck which supports pre-generated decks
    const isOnline = app.isOnline;
    const pregenKey = isOnline ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
    const pregenDeck = app[pregenKey as keyof AppState] as DeckItem[] | null;

    const result = await manageDailyDeck(
        app.entries,
        app.read,
        app.starred,
        app.shuffledOutGuids,
        app.shuffleCount,
        app.filterMode,
        app.lastShuffleResetDate,
        pregenDeck
    );

    // Update the app object with the results
    app.deck = result.deck;
    app.currentDeckGuids = result.currentDeckGuids;
    app.shuffledOutGuids = result.shuffledOutGuids;
    app.shuffleCount = result.shuffleCount;
    app.lastShuffleResetDate = result.lastShuffleResetDate;

    // If pre-generated deck was used, clear it
    if (pregenDeck && pregenDeck.length > 0 && app.currentDeckGuids.length > 0 && 
        app.currentDeckGuids[0].guid === pregenDeck[0].guid) {
        console.log(`[deckManager] Consumed pre-generated ${isOnline ? 'ONLINE' : 'OFFLINE'} deck in processShuffle.`);
        if (pregenKey === 'pregeneratedOnlineDeck') {
            app.pregeneratedOnlineDeck = null;
        } else {
            app.pregeneratedOfflineDeck = null;
        }
        const { saveSimpleState: saveSimpleStateInternal } = await import('../data/dbUserState.ts');
        await saveSimpleStateInternal(pregenKey, null);
    }

    // Automatically select the first item in the new deck
    if (app.deck.length > 0) {
        app.selectedGuid = null; // Clear to ensure watcher triggers and animation plays
        app.$nextTick(() => {
            if (app.deck.length > 0) {
                app.selectItem(app.deck[0].guid);
            }
        });
    }

    displayTemporaryMessageInTitle('Feed shuffled!');
    console.log(`[deckManager] Deck shuffled. Remaining shuffles: ${app.shuffleCount}.`);

    // Kick off a fresh pre-generation in the background
    app.pregenerateDecks();
}