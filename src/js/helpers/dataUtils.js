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

/**
 * Generates a new deck of feed item GUIDs based on the provided data and filters.
 *
 * @param {Array} allFeedItems - An array of all available feed items.
 * @param {Set|Array} hiddenGuids - A Set or Array of GUIDs for hidden items.
 * @param {Set|Array} starredGuids - A Set or Array of GUIDs for starred items.
 * @param {Set|Array} shuffledOutGuids - A Set or Array of GUIDs for shuffled-out items.
 * @param {Set|Array} currentDeckItemGuids - A Set or Array of GUIDs for the current deck.
 * @param {number} count - The desired size of the deck.
 * @param {string} filterMode - The current filter mode ('unread', 'hidden', 'starred').
 * @returns {Array<string>} An array of GUIDs for the new deck.
 */
/**
 * Generates a new deck of feed item GUIDs based on the provided data and filters.
 *
 * @param {Array} allFeedItems - An array of all available feed items.
 * @param {Set|Array} hiddenGuids - A Set or Array of GUIDs for hidden items.
 * @param {Set|Array} starredGuids - A Set or Array of GUIDs for starred items.
 * @param {Set|Array} shuffledOutGuids - A Set or Array of GUIDs for shuffled-out items.
 * @param {Set|Array} currentDeckItemGuids - A Set or Array of GUIDs for the current deck.
 * @param {number} count - The desired size of the deck.
 * @param {string} filterMode - The current filter mode ('unread', 'hidden', 'starred').
 * @returns {Array<string>} An array of GUIDs for the new deck.
 */
export async function generateNewDeck(allFeedItems, hiddenGuids, starredGuids, shuffledOutGuids, currentDeckItemGuids, count, filterMode) {
    try {
        const MAX_DECK_SIZE = 10;
        
        // Ensure all inputs are in the correct format (Sets for efficient lookups).
        const allFeedGuidsSet = new Set(allFeedItems.map(item => item.id));
        const prunedHiddenGuids = new Set(Array.isArray(hiddenGuids) ? hiddenGuids.filter(guid => allFeedGuidsSet.has(guid)) : []);
        const prunedShuffledOutGuids = new Set(Array.isArray(shuffledOutGuids) ? shuffledOutGuids.filter(guid => allFeedGuidsSet.has(guid)) : []);
        
        // FIX: Handle both array of objects (with .guid property) and array of strings
        let starredGuidsSet;
        if (Array.isArray(starredGuids)) {
            if (starredGuids.length > 0 && typeof starredGuids[0] === 'object' && starredGuids[0].guid) {
                // Array of objects with .guid property
                starredGuidsSet = new Set(starredGuids.map(item => item.guid).filter(guid => allFeedGuidsSet.has(guid)));
            } else {
                // Array of strings
                starredGuidsSet = new Set(starredGuids.filter(guid => allFeedGuidsSet.has(guid)));
            }
        } else {
            starredGuidsSet = new Set();
        }
        
        const currentDeckGuidsSet = new Set(Array.isArray(currentDeckItemGuids) ? currentDeckItemGuids : []);

        // Filter allFeedItems based on the selected filterMode
        let filteredItems = [];
        switch (filterMode) {
            case 'hidden':
                filteredItems = allFeedItems.filter(item => prunedHiddenGuids.has(item.id));
                break;
            case 'starred':
                filteredItems = allFeedItems.filter(item => starredGuidsSet.has(item.id));
                break;
            case 'unread':
            default:
                filteredItems = allFeedItems.filter(item =>
                    !prunedHiddenGuids.has(item.id) &&
                    !prunedShuffledOutGuids.has(item.id) &&
                    !currentDeckGuidsSet.has(item.id)
                );
                break;
        }

        // For 'hidden' and 'starred' modes, return the static filtered list.
        if (filterMode === 'hidden' || filterMode === 'starred') {
            filteredItems.sort((a, b) => b.timestamp - a.timestamp);
            return filteredItems.map(item => item.id);
        }

        // --- Complex deck generation logic for 'unread' mode ---
        let nextDeckItems = [];
        const selectedIds = new Set();
        
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

            const trulyRemainingItems = filteredItems.filter(item => !selectedIds.has(item.id));
            const shuffledRemaining = shuffleArray([...trulyRemainingItems]);

            for (const item of shuffledRemaining) {
                if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                tryAddItemToDeck(item);
            }
            
            if (nextDeckItems.length < MAX_DECK_SIZE) {
                const resurfaceCandidates = allFeedItems.filter(item =>
                    prunedShuffledOutGuids.has(item.id) && !prunedHiddenGuids.has(item.id) && !selectedIds.has(item.id)
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

        // Final sort and return
        nextDeckItems.sort((a, b) => b.timestamp - a.timestamp);
        return nextDeckItems.map(item => item.id);

    } catch (error) {
        console.error("An error occurred during deck generation:", error);
        return [];
    }
}