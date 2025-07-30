// www/js/helpers/dataUtils.js

// Import necessary modules for deck functions
import { getDb } from '../data/database.js';
import { loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState } from './userStateUtils.js';
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
    const doc = parser.parseFromString(item.desc || "", "text/html");

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

export function generateNewDeck(allFeedItems, hiddenGuids, shuffledOutGuids, currentDeckItemGuids, count) {
    const hiddenSet = new Set(hiddenGuids);
    const shuffledOutSet = new Set(shuffledOutGuids);
    const currentDeckSet = new Set(currentDeckItemGuids);

    let unreadItems = allFeedItems.filter(item => 
        !hiddenSet.has(item.id) && !shuffledOutSet.has(item.id) && !currentDeckSet.has(item.id)
    );

    let nextDeck = [];
    const MAX_DECK_SIZE = 10;
    let selectedIds = new Set(); // Keep track of IDs already added to nextDeck

    // Helper to add items to the deck without duplicates and respecting max size
    const tryAddItemToDeck = (item) => {
        if (nextDeck.length < MAX_DECK_SIZE && item && !selectedIds.has(item.id)) {
            nextDeck.push(item);
            selectedIds.add(item.id);
            return true;
        }
        return false;
    };

    // Helper to add multiple items from a filtered list, respecting a category limit
    const addItemsFromCategory = (categoryItems, limit) => {
        let count = 0;
        // Iterate over categoryItems, add if not already in deck, and respect limit and MAX_DECK_SIZE
        for (const item of categoryItems) {
            if (count >= limit || nextDeck.length >= MAX_DECK_SIZE) {
                break;
            }
            if (tryAddItemToDeck(item)) {
                count++;
            }
        }
    };

    if (navigator.onLine) {
        const now = Date.now();

        // Define helper checks for prioritization
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

        // 1. Prioritize Recent Items (up to 2)
        const recentItems = unreadItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
        addItemsFromCategory(recentItems, 2);

        // 2. Prioritize Items with Links (up to 1)
        const itemsWithLinks = unreadItems.filter(hasHyperlink);
        addItemsFromCategory(itemsWithLinks, 1);

        // 3. Prioritize Items with Questions in Title (up to 1)
        const itemsWithQuestionTitle = unreadItems.filter(hasQuestionMarkInTitle);
        addItemsFromCategory(itemsWithQuestionTitle, 1);

        // 4. Prioritize Items with Questions in First 150 Chars (up to 1)
        const itemsWithQuestionFirst150 = unreadItems.filter(hasQuestionMarkInDescriptionFirst150);
        addItemsFromCategory(itemsWithQuestionFirst150, 1);

        // 5. Prioritize Items with Questions in Last 150 Chars (up to 1)
        const itemsWithQuestionLast150 = unreadItems.filter(hasQuestionMarkInDescriptionLast150);
        addItemsFromCategory(itemsWithQuestionLast150, 1);

        // 6. Prioritize Items with Images (up to 1)
        const itemsWithImages = unreadItems.filter(hasImage);
        addItemsFromCategory(itemsWithImages, 1);

        // 7. Prioritize Long or Short Items (up to 1 of each)
        const longItems = unreadItems.filter(isLongItem);
        addItemsFromCategory(longItems, 1);
        const shortItems = unreadItems.filter(isShortItem);
        addItemsFromCategory(shortItems, 1);

        // 8. Fill with Random Remaining
        // Get items not yet selected from the original unreadItems pool, then shuffle
        const trulyRemainingItems = unreadItems.filter(item => !selectedIds.has(item.id));
        const shuffledRemaining = shuffleArray([...trulyRemainingItems]);

        for (const item of shuffledRemaining) {
            if (nextDeck.length >= MAX_DECK_SIZE) break;
            tryAddItemToDeck(item);
        }

        // 9. Ensure Full Deck (final fill from any remaining unread, sequential if needed)
        // This ensures the deck is full if there are enough unread items left.
        for (const item of unreadItems) {
            if (nextDeck.length >= MAX_DECK_SIZE) break;
            tryAddItemToDeck(item);
        }
        // Fallback: If deck is not full, add from shuffledOutGuids (prioritizing oldest)
        if (nextDeck.length < MAX_DECK_SIZE) {
            const resurfaceCandidates = allFeedItems.filter(item => 
                shuffledOutSet.has(item.id) && !hiddenSet.has(item.id) && !selectedIds.has(item.id)
            );
            // Sort oldest first for resurfacing
            resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp); 

            for (const item of resurfaceCandidates) {
                if (nextDeck.length >= MAX_DECK_SIZE) break;
                if (tryAddItemToDeck(item)) { 
                    // No need to add to selectedIds as tryAddItemToDeck does that
                }
            }
        }

    } else {
        // Offline fallback: (Prioritized items + specific filtering/unfiltering)

        let filteredItems = [...unreadItems];

        // Initial filters (remove items with specific patterns)
        const hasQuestionMarkInTitle = (item) => item.title.includes('?');
        const hasQuestionMarkInDescriptionFirst150 = (item) => item.description.length >= 150 && item.description.substring(0, 150).includes('?');
        const hasQuestionMarkInDescriptionLast150 = (item) => {
            const desc = item.description;
            return desc.length >= 150 && desc.substring(desc.length - 150).includes('?');
        };
        const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
        const hasImage = (item) => item.image !== "";

        filteredItems = filteredItems.filter(item => !hasQuestionMarkInTitle(item));
        filteredItems = filteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionFirst150(item)));
        filteredItems = filteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionLast150(item)));
        filteredItems = filteredItems.filter(item => !hasHyperlink(item));
        filteredItems = filteredItems.filter(item => !hasImage(item));

        // Undo filters in reverse priority until we have 10 items
        if (filteredItems.length < 10) {
            let itemsToRestore = unreadItems.filter(item => !filteredItems.includes(item));

            // Restore logic based on priority (reverse of filter application) - UPDATED ORDER
            const restoreOrder = [
                (item) => hasImage(item),
                (item) => hasHyperlink(item),
                (item) => (item.description && hasQuestionMarkInDescriptionLast150(item)),
                (item) => (item.description && hasQuestionMarkInDescriptionFirst150(item)),
                (item) => hasQuestionMarkInTitle(item)
            ];

            for (const criterion of restoreOrder) {
                while (filteredItems.length < 10) {
                    const itemToMove = itemsToRestore.find(criterion);
                    if (itemToMove) {
                        filteredItems.push(itemToMove);
                        itemsToRestore = itemsToRestore.filter(i => i !== itemToMove);
                    } else {
                        break; // No more items matching this criterion
                    }
                }
                if (filteredItems.length >= 10) break;
            }

            // Fill with any remaining items if still not 10
            while (filteredItems.length < 10 && itemsToRestore.length > 0) {
                filteredItems.push(itemsToRestore.shift());
            }
        }

        // Prioritize 2 items from the last 24 hours
        const now = Date.now();
        const recentItems = filteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
        nextDeck = recentItems.slice(0, 2);

        // Fill the rest of the deck with remaining items from filteredItems
        const remainingItems = filteredItems.filter(item => !nextDeck.includes(item));
        nextDeck = nextDeck.concat(remainingItems.slice(0, 10 - nextDeck.length));
    }

    // --- NEW: Apply chronological sort to nextDeck for both online and offline paths ---
    nextDeck.sort((a, b) => b.timestamp - a.timestamp);

    // ... (remove saving logic)
    return nextDeck.map(item => item.id);
}