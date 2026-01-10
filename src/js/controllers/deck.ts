import { AppState, DeckItem, MappedFeedItem } from '@/types/app.ts';
import { mapRawItem, formatDate } from '../helpers/dataUtils.ts';
import { _fetchItemsInBatches } from '../data/dbSyncOperations.ts';
import { withDb } from '../data/dbCore.ts';
import { generateNewDeck, processShuffle as helperProcessShuffle, manageDailyDeck } from '../helpers/deckManager.ts';
import { saveSimpleState, et as saveArrayState, saveCurrentDeck } from '../data/dbUserState.ts';
import { displayTemporaryMessageInTitle, updateCounts, createStatusBarMessage } from '../ui/uiUpdaters.ts';
import { isOnline } from '../utils/connectivity.ts';

// Note: dbSyncOperations.ts might be refactored later, so imports might need adjustment if order changes.
// For now, importing from existing locations.

export async function loadAndDisplayDeck(app: AppState): Promise<void> {
    let guidsToDisplay: DeckItem[] = app.currentDeckGuids;
    if (!Array.isArray(guidsToDisplay)) {
        guidsToDisplay = [];
    }

    console.log(`[loadAndDisplayDeck] Processing ${guidsToDisplay.length} GUIDs for display`);
    console.log(`[loadAndDisplayDeck] feedItems contains ${Object.keys(app.feedItems).length} items`);

    const items: MappedFeedItem[] = [];
    const readSet = new Set(app.read.map(h => h.guid.toLowerCase()));
    const starredSet = new Set(app.starred.map(s => s.guid.toLowerCase()));
    const seenGuidsForDeck = new Set<string>();

    const missingGuids: string[] = [];
    let foundCount = 0;

    for (const deckItem of guidsToDisplay) { 
        const guid = deckItem.guid;
        if (typeof guid !== 'string' || !guid) continue;
        
        const item = app.feedItems[guid.toLowerCase()];
        // Check for item existence AND presence of content (description) AND title
        if (item && item.guid && item.description && item.title && !seenGuidsForDeck.has(item.guid.toLowerCase())) {
            const mappedItem = mapRawItem(item, formatDate);
            if (mappedItem && mappedItem.title) { 
                const g = mappedItem.guid.toLowerCase();
                mappedItem.isRead = readSet.has(g);
                mappedItem.isStarred = starredSet.has(g);
                items.push(mappedItem);
                seenGuidsForDeck.add(g);
                foundCount++;
            } else {
                    // If mapRawItem returns null OR title is missing after mapping, treat as missing
                missingGuids.push(guid);
            }
        } else {
            missingGuids.push(guid);
        }
    }

    console.log(`[loadAndDisplayDeck] Found ${foundCount} items locally, ${missingGuids.length} items missing.`);

    // --- SOLUTION: Fetch missing items from server ---
    if (missingGuids.length > 0 && isOnline()) {
        console.log(`[loadAndDisplayDeck] Attempting to fetch ${missingGuids.length} missing items from server...`);
        // Note: Using 'app' as the context for _fetchItemsInBatches might require it to have specific properties
        // The original code passed 'this'. _fetchItemsInBatches expects { progressMessage: string } which AppState has.
        const fetchedItems = await _fetchItemsInBatches(missingGuids, app, missingGuids.length, foundCount);
        
        if (fetchedItems && fetchedItems.length > 0) {
            console.log(`[loadAndDisplayDeck] Successfully fetched ${fetchedItems.length} items from server.`);
            // Save to local DB so they are available next time
            await withDb(async (db: any) => {
                const tx = db.transaction('feedItems', 'readwrite');
                for (const item of fetchedItems) {
                    if (item.guid) {
                        await tx.store.put(item);
                        app.feedItems[item.guid.toLowerCase()] = item;
                    }
                }
                await tx.done;
            });

            // Re-process the missing items into the display items array
            for (const item of fetchedItems) {
                const mappedItem = mapRawItem(item, formatDate);
                if (mappedItem && !seenGuidsForDeck.has(mappedItem.guid.toLowerCase())) {
                    const g = mappedItem.guid.toLowerCase();
                    mappedItem.isRead = readSet.has(g);
                    mappedItem.isStarred = starredSet.has(g);
                    items.push(mappedItem);
                    seenGuidsForDeck.add(g);
                    foundCount++;
                }
            }
        }
    }
    // --- END SOLUTION ---

    app.deck = Array.isArray(items) ? items : [];
    console.log(`[loadAndDisplayDeck] Final deck size: ${app.deck.length}`);
}

export async function processShuffle(app: AppState): Promise<void> {
    if (app.isDemo) {
        app.showCta = true;
        return;
    }
    await helperProcessShuffle(app);
    updateCounts(app);
}

export async function pregenerateDecks(app: AppState): Promise<void> {
    if (!app._isPregenerating) {
        app._isPregenerating = true;
        console.log('[Background] Starting pre-generation of decks...');
        try {
            await _generateAndSavePregeneratedDeck(app, true);  // Online
            await _generateAndSavePregeneratedDeck(app, false); // Offline
            console.log('[Background] Deck pre-generation completed.');
        } catch (e) {
            console.error('[Background] Deck pre-generation failed:', e);
        } finally {
            app._isPregenerating = false;
        }
    }
}

export async function _generateAndSavePregeneratedDeck(app: AppState, online: boolean): Promise<void> {
    const nextDeck = await generateNewDeck(
        Array.from(app.entries),
        app.read,
        app.starred,
        app.shuffledOutGuids,
        'unread', // Default filter mode for pre-gen
        online
    );

    const timestamp = new Date().toISOString();
    // Convert to minimal DeckItem format
    const deckItems: DeckItem[] = (nextDeck || []).map(item => ({
        guid: item.guid,
        addedAt: timestamp
    }));

    const key = online ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
    app[key] = deckItems; // Update local state
    
    await saveSimpleState(key, deckItems, 'userSettings', app);
    console.log(`[Background] Pregenerated ${online ? 'ONLINE' : 'OFFLINE'} deck saved. Size: ${deckItems.length}`);
}

export async function loadDemoDeck(app: AppState): Promise<void> {
    console.log('[Demo] Loading Demo Deck...');
    
    // 1. Check localStorage for user's own items first
    const localItems = localStorage.getItem('userItems');
    if (localItems) {
        try {
            const parsed = JSON.parse(localItems);
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log('[Demo] Loaded from localStorage.');
                // Ensure items are mapped correctly if they were saved raw
                app.deck = parsed.map((item: any) => mapRawItem(item, formatDate) || item);
                return;
            }
        } catch (e) {
            console.error('[Demo] Failed to parse local items:', e);
        }
    }

    // 2. Fetch demo deck
    try {
        const response = await fetch('/api/demo-deck.json');
        if (!response.ok) throw new Error(`Status ${response.status}`);
        const data = await response.json();
        
        // Map items to App format
        // The worker returns 'FeedItem' objects which are compatible with 'raw' items expected by mapRawItem
        const items = (data.items || []).map((item: any) => {
            const mapped = mapRawItem(item, formatDate);
            if (mapped) {
                mapped.isRead = false;
                mapped.isStarred = false;
                return mapped;
            }
            return null;
        }).filter((i: any) => i !== null);
        
        app.deck = items;
        console.log(`[Demo] Loaded ${items.length} items from server.`);
    } catch (e) {
        console.error('[Demo] Failed to load demo deck:', e);
        app.errorMessage = "Could not load demo feed.";
        app.deck = [];
    }
}
