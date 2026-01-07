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

    // Fetch blacklist to ensure effectivelyEmpty check is accurate
    const { loadSimpleState } = await import('../data/dbStateDefs.ts');
    const blacklistRes = await loadSimpleState('keywordBlacklist');
    const keywordBlacklist = (Array.isArray(blacklistRes.value) ? blacklistRes.value : [])
        .map((kw: string) => kw.trim().toLowerCase())
        .filter((kw: string) => kw.length > 0);

    const isBlacklisted = (item: MappedFeedItem): boolean => {
        if (keywordBlacklist.length === 0) return false;
        const searchable = `${item.title} ${item.description} ${item.guid}`.toLowerCase();
        return keywordBlacklist.some((kw: string) => searchable.includes(kw));
    };
    
    const readGuidsSet = new Set(readItemsArray.map(item => getGuid(item).toLowerCase()));
    const starredGuidsSet = new Set(starredItemsArray.map(item => getGuid(item).toLowerCase()));
    const shuffledOutGuidsSet = new Set(shuffledOutItemsArray.map(item => getGuid(item).toLowerCase()));
    
    const entriesMap = new Map(entries.map(e => [e.guid.toLowerCase(), e]));

    // Find items currently in the deck that are still "valid" (unread, not shuffled, not blacklisted)
    const validUnreadInDeck = currentDeckItems
        .map(di => entriesMap.get(getGuid(di).toLowerCase()))
        .filter((item): item is MappedFeedItem => 
            !!item && 
            !readGuidsSet.has(item.guid.toLowerCase()) && 
            !shuffledOutGuidsSet.has(item.guid.toLowerCase()) &&
            !isBlacklisted(item)
        );

    let existingDeck: MappedFeedItem[] = currentDeckItems
        .map(di => entriesMap.get(getGuid(di).toLowerCase()))
        .filter((item): item is MappedFeedItem => !!item);

    const today = new Date().toDateString();
    const isNewDay = lastShuffleResetDate !== today;
    
    const isDeckEmpty = !currentDeckItems || currentDeckItems.length === 0 || existingDeck.length === 0;
    
    // Condition for a refresh: New day, filter mode changed, deck is empty, OR unread deck is running low
    const isUnreadMode = filterMode === 'unread';
    const isDeckRunningLow = isUnreadMode && validUnreadInDeck.length < 10;
    const isFilterModeChanged = !isUnreadMode && filterMode !== 'unread'; // Placeholder logic, refined below

    // We need a more precise "filter changed" check. 
    // If we were in 'unread' and now in 'read', we MUST refresh.
    // If we stay in 'unread', we only refresh if running low or new day.
    
    let needsRefresh = isNewDay || isDeckEmpty || (isUnreadMode && isDeckRunningLow);
    
    // If filter mode is not unread, we usually want to refresh to show the full list for that mode
    if (!isUnreadMode) needsRefresh = true;

    const allItemsInDeckShuffled = !isDeckEmpty && existingDeck.every(item => shuffledOutGuidsSet.has(item.guid.toLowerCase()));

    let newDeck: MappedFeedItem[] = existingDeck;
    let newCurrentDeckGuids: DeckItem[] = currentDeckItems;
    let newShuffledOutGuids: ShuffledOutItem[] = shuffledOutItemsArray;
    let newShuffleCount: number = (typeof shuffleCount === 'number') ? shuffleCount : DAILY_SHUFFLE_LIMIT;
    let newLastShuffleResetDate: string = lastShuffleResetDate || today;

    if (needsRefresh) {
        console.log(`[deckManager] Refreshing deck. Reason: New Day (${isNewDay}), Deck Low/Empty (${isDeckEmpty || isDeckRunningLow}), or Filter Mode (${filterMode}).`);

        // Handle shuffle count refund logic (only if not a new day and deck cleared by reading)
        if (!isNewDay && !isDeckEmpty && validUnreadInDeck.length === 0 && isUnreadMode) {
            if (!allItemsInDeckShuffled) {
                console.log('[deckManager] Automatically incrementing (refunding) shuffleCount due to deck cleared by reading.');
                newShuffleCount = Math.min(DAILY_SHUFFLE_LIMIT, newShuffleCount + 1);
                await saveShuffleState(newShuffleCount, newLastShuffleResetDate);
            }
        }

        let newDeckItems: any[] = [];

        // TOP-UP STRATEGY for unread mode:
        if (isUnreadMode && !isNewDay && !isDeckEmpty) {
            console.log(`[deckManager] Topping up unread deck from ${validUnreadInDeck.length} to 10.`);
            newDeckItems = validUnreadInDeck.map(item => ({ guid: item.guid, addedAt: new Date().toISOString() }));
            
            const existingGuidsInNewDeck = new Set(newDeckItems.map(getGuid).map(g => g.toLowerCase()));

            // 1. Try to use pre-generated items first
            if (pregeneratedDeck && pregeneratedDeck.length > 0) {
                for (const pregenItem of pregeneratedDeck) {
                    if (newDeckItems.length >= 10) break;
                    const guid = getGuid(pregenItem).toLowerCase();
                    if (!existingGuidsInNewDeck.has(guid) && !readGuidsSet.has(guid) && !shuffledOutGuidsSet.has(guid)) {
                        newDeckItems.push(pregenItem);
                        existingGuidsInNewDeck.add(guid);
                    }
                }
            }

            // 2. If still < 10, generate more
            if (newDeckItems.length < 10) {
                const combinedShuffledOut = [...shuffledOutItemsArray, ...newDeckItems.map(getGuid)];
                const topUpItems = await generateNewDeck(
                    entries,
                    readItemsArray,
                    starredItemsArray,
                    combinedShuffledOut,
                    filterMode
                );
                
                for (const item of topUpItems) {
                    if (newDeckItems.length >= 10) break;
                    if (!existingGuidsInNewDeck.has(item.guid.toLowerCase())) {
                        newDeckItems.push({ guid: item.guid, addedAt: new Date().toISOString() });
                        existingGuidsInNewDeck.add(item.guid.toLowerCase());
                    }
                }
            }
        } else {
            // FULL REPLACEMENT (New day, different filter mode, or initially empty)
            console.log(`[deckManager] Performing full deck generation for mode: ${filterMode}`);
            
            let usablePregen = false;
            if (isUnreadMode && pregeneratedDeck && pregeneratedDeck.length > 0) {
                const hasUnread = pregeneratedDeck.some(item => !readGuidsSet.has(getGuid(item).toLowerCase()));
                if (hasUnread) usablePregen = true;
            }

            if (usablePregen && pregeneratedDeck) {
                newDeckItems = [...pregeneratedDeck];
                if (newDeckItems.length < 10) {
                    const topUpItems = await generateNewDeck(
                        entries,
                        readItemsArray,
                        starredItemsArray,
                        [...shuffledOutItemsArray, ...newDeckItems.map(getGuid)],
                        filterMode
                    );
                    newDeckItems = [...newDeckItems, ...topUpItems.map(i => ({ guid: i.guid, addedAt: new Date().toISOString() }))].slice(0, 10);
                }
            } else {
                const items = await generateNewDeck(
                    entries,
                    readItemsArray,
                    starredItemsArray,
                    shuffledOutItemsArray,
                    filterMode
                );
                newDeckItems = items.map(i => ({ guid: i.guid, addedAt: new Date().toISOString() }));
            }
        }
        
        newCurrentDeckGuids = newDeckItems;

        newDeck = newDeckItems
            .map(item => entriesMap.get(getGuid(item).toLowerCase()))
            .filter((item): item is MappedFeedItem => !!item)
            .map(item => ({
                ...item,
                isRead: readGuidsSet.has(item.guid.toLowerCase()),
                isStarred: starredGuidsSet.has(item.guid.toLowerCase())
            }));
        
        await saveCurrentDeck(newCurrentDeckGuids);

        if (isNewDay) {
            newShuffledOutGuids = [];
            await saveArrayState('shuffledOutGuids', []);
            newShuffleCount = DAILY_SHUFFLE_LIMIT;
            await saveShuffleState(newShuffleCount, today);
            newLastShuffleResetDate = today;
            await saveSimpleState('lastShuffleResetDate', today);
        }
    } else {
        // No refresh needed, just update status flags
        newDeck = existingDeck.map(item => ({
            ...item,
            isRead: readGuidsSet.has(item.guid.toLowerCase()),
            isStarred: starredGuidsSet.has(item.guid.toLowerCase())
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
    const existingShuffledGuids: ShuffledOutItem[] = (app.shuffledOutGuids || []).map(item => ({ guid: getGuid(item), shuffledAt: new Date().toISOString() }));
    
    const existingShuffledGuidsSet = new Set(existingShuffledGuids.map(item => item.guid.toLowerCase()));
    const updatedShuffledGuidsSet = new Set([...existingShuffledGuidsSet, ...visibleGuids.map(g => g.toLowerCase())]);
    
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