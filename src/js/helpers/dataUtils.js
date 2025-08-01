// www/js/helpers/dataUtils.js

// Import necessary modules for deck functions
import { getDb } from '../data/database.js';
import { loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, getUserSetting, setUserSetting } from './userStateUtils.js';
import { displayTemporaryMessageInTitle, createStatusBarMessage } from '../ui/uiUpdaters.js';

export function formatDate(dateStr) {
    const now = new Date();
    const date = new Date(dateStr);
    const secs = Math.floor((now - date) / 1000);
    const TWO_WEEKS_SECS = 2 * 7 * 24 * 60 * 60;

    if (secs > TWO_WEEKS_SECS) {
        return date.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (secs < 60) return "Just now";
    if (mins < 60) return `${mins} minute${mins !== 1 ? "s" : ""} ago`;
    if (hrs < 24) return `${hrs} hour${hrs !== 1 ? "s" : ""} ago`;
    if (days < 7) return `${days} day${days !== 1 ? "s" : ""} ago`;

    const weeks = Math.floor(days / 7);
    return `${weeks} week${weeks !== 1 ? "s" : ""} ago`;
}

export function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function mapRawItem(item, fmtFn) {
    if (!item) {
        console.warn("mapRawItem received an undefined or null item. Returning null.");
        return null;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(item.description || "", "text/html");

    const imgEl = doc.querySelector("img");
    const imgSrc = imgEl?.src || "";
    imgEl?.remove();

    let sourceUrl = "";
    const sourceEl = doc.querySelector(".source-url") || doc.querySelector("a");
    if (sourceEl) {
        sourceUrl = sourceEl.textContent.trim();
        sourceEl.remove();
    } else {
        sourceUrl = item.link ? new URL(item.link).hostname : "";
    }

    const descContent = doc.body.innerHTML.trim();
    const ts = Date.parse(item.pubDate) || 0;

    return {
        id: item.guid,
        image: imgSrc,
        title: item.title,
        link: item.link,
        pubDate: fmtFn(item.pubDate || ""),
        description: descContent,
        source: sourceUrl,
        timestamp: ts
    };
}
export function mapRawItems(rawList, fmtFn) {
    if (!Array.isArray(rawList)) {
        console.warn("mapRawItems received a non-array input. Returning empty array.");
        return [];
    }
    return rawList
        .map(item => mapRawItem(item, fmtFn))
        .filter(item => item !== null)
        .sort((a, b) => b.timestamp - a.timestamp);
}

export async function generateNewDeck(allFeedItems, hiddenGuids, starredGuids, shuffledOutGuids, currentDeckItemGuids, count, filterMode) {
    try {
        // ADD THIS DEBUG LOGGING
        console.log('[DEBUG] generateNewDeck params:', {
            allFeedItemsCount: allFeedItems?.length || 0,
            hiddenGuidsCount: hiddenGuids?.size || hiddenGuids?.length || 0,
            starredGuidsCount: starredGuids?.size || starredGuids?.length || 0,
            shuffledOutGuidsCount: shuffledOutGuids?.size || shuffledOutGuids?.length || 0,
            currentDeckItemGuidsType: typeof currentDeckItemGuids,
            currentDeckItemGuidsIsSet: currentDeckItemGuids instanceof Set,
            currentDeckItemGuidsCount: currentDeckItemGuids?.size || currentDeckItemGuids?.length || 0,
            filterMode
        });

        let nextDeck = [];
        const MAX_DECK_SIZE = 10;
        
        const allFeedGuidsSet = new Set(allFeedItems.map(item => item.id));
        
        // Ensure currentDeckItemGuids is a Set
        const currentDeckGuidsSet = currentDeckItemGuids instanceof Set 
            ? currentDeckItemGuids 
            : new Set(Array.isArray(currentDeckItemGuids) ? currentDeckItemGuids.filter(guid => guid != null) : []);
            
        console.log('[DEBUG] currentDeckGuidsSet size:', currentDeckGuidsSet.size);
        
        const hiddenItemsArray = [...hiddenGuids];
        const prunedHiddenItemsArray = hiddenItemsArray.filter(guid => allFeedGuidsSet.has(guid));
        const prunedHiddenGuids = new Set(prunedHiddenItemsArray);

        if (prunedHiddenItemsArray.length !== hiddenItemsArray.length) {
            await setUserSetting('hidden', prunedHiddenItemsArray);
            console.log(`[DATA] Pruned hidden items. Removed ${hiddenItemsArray.length - prunedHiddenItemsArray.length} stale items.`);
        }

        const prunedShuffledOutGuids = new Set([...shuffledOutGuids].filter(guid => allFeedGuidsSet.has(guid)));

        // Filter allFeedItems based on the selected filterMode
        let filteredItems = [];
        switch (filterMode) {
            case 'hidden':
                filteredItems = allFeedItems.filter(item => prunedHiddenGuids.has(item.id));
                console.log('[DEBUG] Hidden filter - filteredItems count:', filteredItems.length);
                break;
            case 'starred':
                // Assuming `starredGuids` is a Set of GUIDs, similar to `hiddenGuids`
                const starredGuidsSet = new Set(starredGuids);
                filteredItems = allFeedItems.filter(item => starredGuidsSet.has(item.id));
                console.log('[DEBUG] Starred filter - filteredItems count:', filteredItems.length);
                break;
            case 'unread':
            default:
                // This is the original logic for generating the 'unread' deck
                filteredItems = allFeedItems.filter(item =>
                    !prunedHiddenGuids.has(item.id) &&
                    !prunedShuffledOutGuids.has(item.id) &&
                    !currentDeckGuidsSet.has(item.id)
                );
                
                console.log('[DEBUG] Unread filter - after filtering:', {
                    filteredItemsCount: filteredItems.length,
                    totalItems: allFeedItems.length,
                    hiddenCount: prunedHiddenGuids.size,
                    shuffledOutCount: prunedShuffledOutGuids.size,
                    currentDeckCount: currentDeckGuidsSet.size,
                    sampleFilteredIds: filteredItems.slice(0, 3).map(item => item.id)
                });
                break;
        }

        // For `hidden` and `starred` modes, simply return the filtered list,
        // as they are a static view of the user's lists and not a dynamic deck.
        if (filterMode === 'hidden' || filterMode === 'starred') {
            // Sort by timestamp to ensure consistent order
            filteredItems.sort((a, b) => b.timestamp - a.timestamp);
            console.log('[DEBUG] Returning static list for', filterMode, 'with', filteredItems.length, 'items');
            return filteredItems.map(item => item.id);
        }

        // If not a static list, continue with the complex deck generation logic for 'unread'
        let nextDeckItems = [];
        let selectedIds = new Set();
        
        console.log('[DEBUG] Starting deck generation with', filteredItems.length, 'filtered items');
        
        const tryAddItemToDeck = (item) => {
            if (nextDeckItems.length < MAX_DECK_SIZE && item && !selectedIds.has(item.id)) {
                nextDeckItems.push(item);
                selectedIds.add(item.id);
                return true;
            }
            return false;
        };

        const addItemsFromCategory = (categoryItems, limit) => {
            let count = 0;
            for (const item of categoryItems) {
                if (count >= limit || nextDeckItems.length >= MAX_DECK_SIZE) {
                    break;
                }
                if (tryAddItemToDeck(item)) {
                    count++;
                }
            }
        };

        if (navigator.onLine) {
            console.log('[DEBUG] Online mode - applying complex filtering');
            const now = Date.now();
            const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
            const hasQuestionMarkInTitle = (item) => item.title.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item) => item.description.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item) => {
                const desc = item.description;
                return desc.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasImage = (item) => item.image !== "";
            const isLongItem = (item) => item.description.length >= 750;
            const isShortItem = (item) => item.description.length < 750;

            const recentItems = filteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            console.log('[DEBUG] Recent items (24h):', recentItems.length);
            addItemsFromCategory(recentItems, 2);

            const itemsWithLinks = filteredItems.filter(hasHyperlink);
            console.log('[DEBUG] Items with links:', itemsWithLinks.length);
            addItemsFromCategory(itemsWithLinks, 1);

            const itemsWithQuestionTitle = filteredItems.filter(hasQuestionMarkInTitle);
            console.log('[DEBUG] Items with question in title:', itemsWithQuestionTitle.length);
            addItemsFromCategory(itemsWithQuestionTitle, 1);

            const itemsWithQuestionFirst150 = filteredItems.filter(hasQuestionMarkInDescriptionFirst150);
            console.log('[DEBUG] Items with question in first 150 chars:', itemsWithQuestionFirst150.length);
            addItemsFromCategory(itemsWithQuestionFirst150, 1);

            const itemsWithQuestionLast150 = filteredItems.filter(hasQuestionMarkInDescriptionLast150);
            console.log('[DEBUG] Items with question in last 150 chars:', itemsWithQuestionLast150.length);
            addItemsFromCategory(itemsWithQuestionLast150, 1);

            const itemsWithImages = filteredItems.filter(hasImage);
            console.log('[DEBUG] Items with images:', itemsWithImages.length);
            addItemsFromCategory(itemsWithImages, 1);

            const longItems = filteredItems.filter(isLongItem);
            console.log('[DEBUG] Long items (>=750 chars):', longItems.length);
            addItemsFromCategory(longItems, 1);
            
            const shortItems = filteredItems.filter(isShortItem);
            console.log('[DEBUG] Short items (<750 chars):', shortItems.length);
            addItemsFromCategory(shortItems, 1);

            console.log('[DEBUG] After category selection, deck has:', nextDeckItems.length, 'items');

            const trulyRemainingItems = filteredItems.filter(item => !selectedIds.has(item.id));
            console.log('[DEBUG] Remaining unselected items:', trulyRemainingItems.length);
            const shuffledRemaining = shuffleArray([...trulyRemainingItems]);

            for (const item of shuffledRemaining) {
                if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                tryAddItemToDeck(item);
            }
            
            console.log('[DEBUG] After adding remaining items, deck has:', nextDeckItems.length, 'items');
            
            if (nextDeckItems.length < MAX_DECK_SIZE) {
                const resurfaceCandidates = allFeedItems.filter(item =>
                    prunedShuffledOutGuids.has(item.id) && !prunedHiddenGuids.has(item.id) && !selectedIds.has(item.id)
                );
                resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp);
                console.log('[DEBUG] Resurfacing candidates:', resurfaceCandidates.length);

                for (const item of resurfaceCandidates) {
                    if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                    tryAddItemToDeck(item);
                }
                
                console.log('[DEBUG] After resurfacing, deck has:', nextDeckItems.length, 'items');
            }

        } else {
            console.log('[DEBUG] Offline mode - applying simplified filtering');
            // Offline fallback
            let offlineFilteredItems = [...filteredItems];

            const hasQuestionMarkInTitle = (item) => item.title.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item) => item.description.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item) => {
                const desc = item.description;
                return desc.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
            const hasImage = (item) => item.image !== "";

            offlineFilteredItems = offlineFilteredItems.filter(item => !hasQuestionMarkInTitle(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionFirst150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionLast150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasHyperlink(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasImage(item));

            console.log('[DEBUG] After offline filtering, items count:', offlineFilteredItems.length);

            if (offlineFilteredItems.length < 10) {
                let itemsToRestore = filteredItems.filter(item => !offlineFilteredItems.includes(item));

                const restoreOrder = [
                    (item) => hasImage(item),
                    (item) => hasHyperlink(item),
                    (item) => (item.description && hasQuestionMarkInDescriptionLast150(item)),
                    (item) => (item.description && hasQuestionMarkInDescriptionFirst150(item)),
                    (item) => hasQuestionMarkInTitle(item)
                ];

                for (const criterion of restoreOrder) {
                    while (offlineFilteredItems.length < 10) {
                        const itemToMove = itemsToRestore.find(criterion);
                        if (itemToMove) {
                            offlineFilteredItems.push(itemToMove);
                            itemsToRestore = itemsToRestore.filter(i => i !== itemToMove);
                        } else {
                            break;
                        }
                    }
                    if (offlineFilteredItems.length >= 10) break;
                }

                while (offlineFilteredItems.length < 10 && itemsToRestore.length > 0) {
                    offlineFilteredItems.push(itemsToRestore.shift());
                }
                
                console.log('[DEBUG] After restoration, offline items count:', offlineFilteredItems.length);
            }

            const now = Date.now();
            const recentItems = offlineFilteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            nextDeckItems = recentItems.slice(0, 2);
            console.log('[DEBUG] Offline recent items selected:', nextDeckItems.length);

            const remainingItems = offlineFilteredItems.filter(item => !nextDeckItems.includes(item));
            nextDeckItems = nextDeckItems.concat(remainingItems.slice(0, 10 - nextDeckItems.length));
            console.log('[DEBUG] Final offline deck size:', nextDeckItems.length);
        }

        // Final safety sort
        nextDeckItems.sort((a, b) => b.timestamp - a.timestamp);
        
        const finalDeckGuids = nextDeckItems.map(item => item.id);
        console.log('[DEBUG] Final deck generated:', {
            deckSize: finalDeckGuids.length,
            deckGuids: finalDeckGuids
        });
        
        // Extra safety check
        if (!Array.isArray(finalDeckGuids)) {
            console.error('[DEBUG] ERROR: finalDeckGuids is not an array!', typeof finalDeckGuids, finalDeckGuids);
            return [];
        }
        
        return finalDeckGuids;
    } catch (error) {
        console.error("An error occurred during deck generation:", error);
        console.error("Stack trace:", error.stack);
        return [];
    }
}
