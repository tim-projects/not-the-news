// @filepath: src/js/helpers/dataUtils.js

// Refactored JS: concise, modern, functional, same output.

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
        guid: item.guid,
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

/**
 * Generates a new deck of feed items based on the provided data and filters.
 *
 * @param {Array<Object>} allFeedItems - An array of all available feed items.
 * @param {Array<Object|string>} hiddenItems - An array of hidden item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} starredItems - An array of starred item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} shuffledOutItems - An array of shuffled-out item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} currentDeckItems - An array of the current deck's item objects (or GUIDs for legacy data).
 * @param {number} count - The desired size of the deck.
 * @param {string} filterMode - The current filter mode ('unread', 'hidden', 'starred').
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of full item objects for the new deck.
 */
export async function generateNewDeck(allFeedItems, hiddenItems, starredItems, shuffledOutItems, currentDeckItems, count, filterMode) {
    try {
        const MAX_DECK_SIZE = 10;

        /**
         * Safely extracts GUIDs from an array that might contain full objects or raw strings,
         * supporting the data migration period.
         * @param {Array<Object|string>} arr - The array to process.
         * @returns {Set<string>} A Set of GUIDs.
         */
        const getGuidSet = (arr) => {
            if (!Array.isArray(arr)) {
                return new Set();
            }
            const guids = arr.map(item => (typeof item === 'object' && item.guid ? item.guid : item));
            return new Set(guids.filter(Boolean)); // Filter out any null/undefined values
        };

        const allFeedGuidsSet = new Set(allFeedItems.map(item => item.guid));

        // Create GUID sets for efficient lookups, pruning GUIDs that no longer exist in the main feed.
        const hiddenGuidsSet = new Set([...getGuidSet(hiddenItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const starredGuidsSet = new Set([...getGuidSet(starredItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const shuffledOutGuidsSet = new Set([...getGuidSet(shuffledOutItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const currentDeckGuidsSet = getGuidSet(currentDeckItems);

        let filteredItems = [];
        switch (filterMode) {
            case 'hidden':
                filteredItems = allFeedItems.filter(item => hiddenGuidsSet.has(item.guid));
                break;
            case 'starred':
                filteredItems = allFeedItems.filter(item => starredGuidsSet.has(item.guid));
                break;
            case 'unread':
            default:
                filteredItems = allFeedItems.filter(item =>
                    !hiddenGuidsSet.has(item.guid) &&
                    !shuffledOutGuidsSet.has(item.guid) &&
                    !currentDeckGuidsSet.has(item.guid)
                );
                break;
        }

        if (filterMode === 'hidden' || filterMode === 'starred') {
            filteredItems.sort((a, b) => b.timestamp - a.timestamp);
            // ARCHITECTURE CHANGE: Return full objects instead of just GUIDs.
            return filteredItems;
        }

        let nextDeckItems = [];
        const selectedIds = new Set();
        
        const tryAddItemToDeck = (item) => {
            if (nextDeckItems.length < MAX_DECK_SIZE && item && !selectedIds.has(item.guid)) {
                nextDeckItems.push(item);
                selectedIds.add(item.guid);
                return true;
            }
            return false;
        };

        const addItemsFromCategory = (categoryItems, limit) => {
            let count = 0;
            for (const item of categoryItems) {
                if (count >= limit || nextDeckItems.length >= MAX_DECK_SIZE) break;
                if (tryAddItemToDeck(item)) count++;
            }
        };

        if (navigator.onLine) {
            const now = Date.now();
            const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
            const hasQuestionMarkInTitle = (item) => item.title?.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item) => item.description?.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item) => {
                const desc = item.description;
                return desc?.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasImage = (item) => item.image !== "";
            const isLongItem = (item) => item.description?.length >= 750;
            const isShortItem = (item) => item.description?.length < 750;

            const recentItems = filteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            addItemsFromCategory(recentItems, 2);

            const itemsWithLinks = filteredItems.filter(hasHyperlink);
            addItemsFromCategory(itemsWithLinks, 1);

            const itemsWithQuestionTitle = filteredItems.filter(hasQuestionMarkInTitle);
            addItemsFromCategory(itemsWithQuestionTitle, 1);

            const itemsWithQuestionFirst150 = filteredItems.filter(hasQuestionMarkInDescriptionFirst150);
            addItemsFromCategory(itemsWithQuestionFirst150, 1);

            const itemsWithQuestionLast150 = filteredItems.filter(hasQuestionMarkInDescriptionLast150);
            addItemsFromCategory(itemsWithQuestionLast150, 1);

            const itemsWithImages = filteredItems.filter(hasImage);
            addItemsFromCategory(itemsWithImages, 1);

            const longItems = filteredItems.filter(isLongItem);
            addItemsFromCategory(longItems, 1);
            
            const shortItems = filteredItems.filter(isShortItem);
            addItemsFromCategory(shortItems, 1);

            const trulyRemainingItems = filteredItems.filter(item => !selectedIds.has(item.guid));
            const shuffledRemaining = shuffleArray([...trulyRemainingItems]);

            for (const item of shuffledRemaining) {
                if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                tryAddItemToDeck(item);
            }
            
            if (nextDeckItems.length < MAX_DECK_SIZE) {
                const resurfaceCandidates = allFeedItems.filter(item =>
                    shuffledOutGuidsSet.has(item.guid) && !hiddenGuidsSet.has(item.guid) && !selectedIds.has(item.guid)
                );
                resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp);

                for (const item of resurfaceCandidates) {
                    if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                    tryAddItemToDeck(item);
                }
            }
        } else {
            // Offline fallback
            let offlineFilteredItems = [...filteredItems];

            const hasQuestionMarkInTitle = (item) => item.title?.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item) => item.description?.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item) => {
                const desc = item.description;
                return desc?.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
            const hasImage = (item) => item.image !== "";

            offlineFilteredItems = offlineFilteredItems.filter(item => !hasQuestionMarkInTitle(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionFirst150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionLast150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasHyperlink(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasImage(item));

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
            }

            const now = Date.now();
            const recentItems = offlineFilteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            nextDeckItems = recentItems.slice(0, 2);

            const remainingItems = offlineFilteredItems.filter(item => !nextDeckItems.includes(item));
            nextDeckItems = nextDeckItems.concat(remainingItems.slice(0, 10 - nextDeckItems.length));
        }

        // [FIX] START: Fallback logic to prevent an empty deck.
        // This block runs if the deck is still not full, which happens when
        // the initial 'unread' pool is empty.
        if (nextDeckItems.length < MAX_DECK_SIZE && allFeedItems.length > 0) {
            console.warn("[generateNewDeck] Deck is smaller than desired. Activating fallback to resurface oldest hidden/shuffled items.");

            const allItemsMap = new Map(allFeedItems.map(item => [item.guid, item]));
            const guidsInDeck = new Set(nextDeckItems.map(item => item.guid));

            // Combine hidden and shuffled items into a pool of candidates for resurfacing.
            const resurfaceCandidates = [
                ...hiddenItems.filter(item => typeof item === 'object' && item.guid),
                ...shuffledOutItems.filter(item => typeof item === 'object' && item.guid)
            ];

            // Filter out items already in the deck or that no longer exist, then sort by timestamp (oldest first).
            const validCandidates = resurfaceCandidates
                .filter(candidate => !guidsInDeck.has(candidate.guid) && allItemsMap.has(candidate.guid))
                .sort((a, b) => {
                    const timeA = new Date(a.hiddenAt || a.shuffledAt || 0).getTime();
                    const timeB = new Date(b.hiddenAt || b.shuffledAt || 0).getTime();
                    return timeA - timeB; // Sort ascending to get the oldest items first.
                });

            // Add the oldest valid candidates to the deck until it's full.
            for (const candidate of validCandidates) {
                if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                const fullItem = allItemsMap.get(candidate.guid);
                if (fullItem) {
                    nextDeckItems.push(fullItem);
                }
            }
        }
        // [FIX] END: Fallback logic.

        nextDeckItems.sort((a, b) => b.timestamp - a.timestamp);

        // ARCHITECTURE CHANGE: Return the full objects for the deck, not just the GUIDs.
        // This preserves the object structure as required by the new architecture.
        return nextDeckItems;

    } catch (error) {
        console.error("An error occurred during deck generation:", error);
        return [];
    }
}