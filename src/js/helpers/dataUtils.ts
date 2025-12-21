// @filepath: src/js/helpers/dataUtils.js

// Refactored JS: concise, modern, functional, same output.

import { MappedFeedItem, ReadItem, StarredItem, DeckItem, ShuffledOutItem } from '@/types/app.ts';

interface RawFeedItem {
    guid: string;
    title: string;
    link: string;
    pubDate: string;
    description: string;
    // Add other properties if they exist in the raw item
}


export function formatDate(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const secs = Math.floor((now.getTime() - date.getTime()) / 1000); // Use getTime() for comparison
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

export function shuffleArray<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function mapRawItem(item: RawFeedItem | null, fmtFn: (dateStr: string) => string): MappedFeedItem | null {
    if (!item) {
        console.warn("mapRawItem received an undefined or null item. Returning null.");
        return null;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(item.description || "", "text/html");

    const imgEl = doc.querySelector("img") as HTMLImageElement | null; // Cast to HTMLImageElement
    const imgSrc = imgEl?.src || "";
    imgEl?.remove();

    let sourceUrl = "";
    const sourceEl = doc.querySelector(".source-url") || doc.querySelector("a");
    if (sourceEl) {
        sourceUrl = sourceEl.textContent?.trim() || ""; // Add nullish coalescing
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

export function mapRawItems(rawList: RawFeedItem[], fmtFn: (dateStr: string) => string): MappedFeedItem[] {
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    console.log(`ENTERING mapRawItems. rawList length: ${rawList.length}`);
    if (!Array.isArray(rawList)) {
        console.warn("mapRawItems received a non-array input. Returning empty array.");
        return [];
    }
    const mappedAndFiltered = rawList
        .map(item => mapRawItem(item, fmtFn))
        .filter((item): item is MappedFeedItem => item !== null) // Type guard for filter
        .sort((a, b) => b.timestamp - a.timestamp);
    console.log(`EXITING mapRawItems. Returning length: ${mappedAndFiltered.length}`);
    return mappedAndFiltered;
}

/**
 * Generates a new deck of feed items based on the provided data and filters.
 *
 * @param {Array<Object>} allFeedItems - An array of all available feed items.
 * @param {Array<Object|string>} readItems - An array of read item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} starredItems - An array of starred item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} shuffledOutItems - An array of shuffled-out item objects (or GUIDs for legacy data).
 * @param {Array<Object|string>} currentDeckItems - An array of the current deck's item objects (or GUIDs for legacy data).
 * @param {number} count - The desired size of the deck.
 * @param {string} filterMode - The current filter mode ('unread', 'read', 'starred').
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of full item objects for the new deck.
 */
export async function generateNewDeck(
    allFeedItems: MappedFeedItem[],
    readItems: (ReadItem | string)[], // Can be ReadItem objects or just GUID strings (legacy)
    starredItems: (StarredItem | string)[], // Can be StarredItem objects or just GUID strings (legacy)
    shuffledOutItems: (DeckItem | string | ShuffledOutItem)[], // Can be DeckItem objects or just GUID strings (legacy)
    filterMode: string
): Promise<MappedFeedItem[]> {
    console.log("ENTERING generateNewDeck with filterMode:", filterMode);
    console.log("generateNewDeck: allFeedItems count:", allFeedItems.length);
    console.log("generateNewDeck: readItems count:", readItems.length);
    try {
        const MAX_DECK_SIZE = 10;

        /**
         * Safely extracts GUIDs from an array that might contain full objects or raw strings,
         * supporting the data migration period.
         * @param {Array<Object|string>} arr - The array to process.
         * @returns {Set<string>} A Set of GUIDs.
         */
                const getGuidSet = (arr: (ReadItem | StarredItem | DeckItem | string | ShuffledOutItem)[]): Set<string> => { // Use union type for array elements
            if (!Array.isArray(arr)) {
                return new Set();
            }
            const guids = arr.map(item => (typeof item === 'object' && 'guid' in item && item.guid ? item.guid : item)); // Check for 'guid' property
            return new Set(guids.filter((guid): guid is string => typeof guid === 'string' && Boolean(guid))); // Filter out any non-string/empty values
        };

        const allFeedGuidsSet = new Set(allFeedItems.map(item => item.guid));

        const readGuidsSet = new Set([...getGuidSet(readItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const starredGuidsSet = new Set([...getGuidSet(starredItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const shuffledOutGuidsSet = new Set([...getGuidSet(shuffledOutItems)].filter(guid => allFeedGuidsSet.has(guid)));
        // const currentDeckGuidsSet = getGuidSet(currentDeckItems); // Removed as it was unused

        let filteredItems: MappedFeedItem[] = [];
        console.log(`[generateNewDeck] Initial filteredItems count: ${filteredItems.length}`);
        switch (filterMode) {
            case 'read':
                filteredItems = allFeedItems.filter(item => readGuidsSet.has(item.guid));
                break;
            case 'starred':
                filteredItems = allFeedItems.filter(item => starredGuidsSet.has(item.guid));
                break;
            case 'unread':
            default:
                filteredItems = allFeedItems.filter(item =>
                    !readGuidsSet.has(item.guid) &&
                    !shuffledOutGuidsSet.has(item.guid)
                );
                // If all items are read and the deck is empty, we should still generate a new deck.
                if (filteredItems.length === 0) {
                    console.log('generateNewDeck: No unread/unshuffled items found, re-filtering from all items.');
                    filteredItems = allFeedItems.filter(item => !shuffledOutGuidsSet.has(item.guid));
                }
                break;
        }
        console.log('generateNewDeck: Final filteredItems count:', filteredItems.length);

        if (filterMode === 'read' || filterMode === 'starred') {
            filteredItems.sort((a, b) => b.timestamp - a.timestamp);
            console.log(`[generateNewDeck] Filtered items for ${filterMode}: ${filteredItems.length}`);
            return filteredItems;
        }

        let nextDeckItems: MappedFeedItem[] = [];
        const selectedIds = new Set<string>(); // Set to store GUIDs

        const tryAddItemToDeck = (item: MappedFeedItem): boolean => {
            if (nextDeckItems.length < MAX_DECK_SIZE && item && !selectedIds.has(item.guid)) {
                nextDeckItems.push(item);
                selectedIds.add(item.guid);
                return true;
            }
            return false;
        };

        const addItemsFromCategory = (categoryItems: MappedFeedItem[], limit: number) => {
            let count = 0;
            for (const item of categoryItems) {
                if (count >= limit || nextDeckItems.length >= MAX_DECK_SIZE) break;
                if (tryAddItemToDeck(item)) count++;
            }
        };

        if (navigator.onLine) {
            const now = Date.now();
            const hasHyperlink = (item: MappedFeedItem) => /<a\s+href=/i.test(item.description);
            const hasQuestionMarkInTitle = (item: MappedFeedItem) => item.title?.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item: MappedFeedItem) => item.description?.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item: MappedFeedItem) => {
                const desc = item.description;
                return desc?.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasImage = (item: MappedFeedItem) => item.image !== "";
            const isLongItem = (item: MappedFeedItem) => item.description?.length >= 750;
            const isShortItem = (item: MappedFeedItem) => item.description?.length < 750;

            const recentItems = filteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            addItemsFromCategory(recentItems, 2);
            console.log(`[generateNewDeck] After recentItems: ${nextDeckItems.length}`);

            const itemsWithLinks = filteredItems.filter(hasHyperlink);
            addItemsFromCategory(itemsWithLinks, 1);
            console.log(`[generateNewDeck] After itemsWithLinks: ${nextDeckItems.length}`);

            const itemsWithQuestionTitle = filteredItems.filter(hasQuestionMarkInTitle);
            addItemsFromCategory(itemsWithQuestionTitle, 1);
            console.log(`[generateNewDeck] After itemsWithQuestionTitle: ${nextDeckItems.length}`);

            const itemsWithQuestionFirst150 = filteredItems.filter(hasQuestionMarkInDescriptionFirst150);
            addItemsFromCategory(itemsWithQuestionFirst150, 1);
            console.log(`[generateNewDeck] After itemsWithQuestionFirst150: ${nextDeckItems.length}`);

            const itemsWithQuestionLast150 = filteredItems.filter(hasQuestionMarkInDescriptionLast150);
            addItemsFromCategory(itemsWithQuestionLast150, 1);
            console.log(`[generateNewDeck] After itemsWithQuestionLast150: ${nextDeckItems.length}`);

            const itemsWithImages = filteredItems.filter(hasImage);
            addItemsFromCategory(itemsWithImages, 1);
            console.log(`[generateNewDeck] After itemsWithImages: ${nextDeckItems.length}`);

            const longItems = filteredItems.filter(isLongItem);
            addItemsFromCategory(longItems, 1);
            console.log(`[generateNewDeck] After longItems: ${nextDeckItems.length}`);
            
            const shortItems = filteredItems.filter(isShortItem);
            addItemsFromCategory(shortItems, 1);
            console.log(`[generateNewDeck] After shortItems: ${nextDeckItems.length}`);

            const trulyRemainingItems = filteredItems.filter(item => !selectedIds.has(item.guid));
            const shuffledRemaining = shuffleArray([...trulyRemainingItems]);

            for (const item of shuffledRemaining) {
                if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                tryAddItemToDeck(item);
            }
            console.log(`[generateNewDeck] After shuffledRemaining: ${nextDeckItems.length}`);
            
            if (nextDeckItems.length < MAX_DECK_SIZE) {
                const resurfaceCandidates = allFeedItems.filter(item =>
                    shuffledOutGuidsSet.has(item.guid) && !readGuidsSet.has(item.guid) && !selectedIds.has(item.guid)
                );
                resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp);

                for (const candidate of resurfaceCandidates) {
                    if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                    tryAddItemToDeck(candidate);
                }
                console.log(`[generateNewDeck] After resurfaceCandidates: ${nextDeckItems.length}`);

                if (nextDeckItems.length < MAX_DECK_SIZE) {
                    const remainingAllItems = allFeedItems.filter(item => !selectedIds.has(item.guid));
                    remainingAllItems.sort((a, b) => a.timestamp - b.timestamp);

                    for (const item of remainingAllItems) {
                        if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                        nextDeckItems.push(item);
                        selectedIds.add(item.guid);
                    }
                    console.log(`[generateNewDeck] After remainingAllItems: ${nextDeckItems.length}`);
                }
            }
        } else {
            // Offline fallback
            let offlineFilteredItems: MappedFeedItem[] = [...filteredItems];

            const hasQuestionMarkInTitle = (item: MappedFeedItem) => item.title?.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item: MappedFeedItem) => item.description?.length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item: MappedFeedItem) => {
                const desc = item.description;
                return desc?.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            const hasHyperlink = (item: MappedFeedItem) => /<a\s+href=/i.test(item.description);
            const hasImage = (item: MappedFeedItem) => item.image !== "";

            offlineFilteredItems = offlineFilteredItems.filter(item => !hasQuestionMarkInTitle(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionFirst150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !(item.description && hasQuestionMarkInDescriptionLast150(item)));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasHyperlink(item));
            offlineFilteredItems = offlineFilteredItems.filter(item => !hasImage(item));

            if (offlineFilteredItems.length < 10) {
                let itemsToRestore = filteredItems.filter(item => !offlineFilteredItems.includes(item));

                const restoreOrder = [
                    (item: MappedFeedItem) => hasImage(item),
                    (item: MappedFeedItem) => hasHyperlink(item),
                    (item: MappedFeedItem) => (item.description && hasQuestionMarkInDescriptionLast150(item)),
                    (item: MappedFeedItem) => (item.description && hasQuestionMarkInDescriptionFirst150(item)),
                    (item: MappedFeedItem) => hasQuestionMarkInTitle(item)
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
                    offlineFilteredItems.push(itemsToRestore.shift() as MappedFeedItem); // Cast as MappedFeedItem
                }
            }

            const now = Date.now();
            const recentItems = offlineFilteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            nextDeckItems = recentItems.slice(0, 2);

            const remainingItems = offlineFilteredItems.filter(item => !nextDeckItems.includes(item));
            nextDeckItems = nextDeckItems.concat(remainingItems.slice(0, 10 - nextDeckItems.length));
        }

        nextDeckItems.sort((a, b) => b.timestamp - a.timestamp);

        return nextDeckItems;

    } catch (error) {
        console.error("An error occurred during deck generation:", error);
        return [];
    }
}