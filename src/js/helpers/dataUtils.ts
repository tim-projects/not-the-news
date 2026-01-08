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

/**
 * Robustly parses RSS feed configuration which can be either a nested object (seeded)
 * or a flat array of strings (user-saved).
 */
export function parseRssFeedsConfig(value: any): string[] {
    const allUrls: string[] = [];
    if (!value) return allUrls;

    if (Array.isArray(value)) {
        // Flat array of strings or objects
        value.forEach((item: any) => {
            if (typeof item === 'string') {
                allUrls.push(item); // Include empty strings to preserve lines
            } else if (item && typeof item === 'object' && item.url) {
                allUrls.push(item.url.trim());
            }
        });
    } else if (typeof value === 'object') {
        // Nested structure: { Category: { Subcategory: [ { url: '...' }, ... ] } }
        for (const category in value) {
            const subcategories = value[category];
            if (subcategories && typeof subcategories === 'object') {
                for (const subcategory in subcategories) {
                    const feeds = subcategories[subcategory];
                    if (Array.isArray(feeds)) {
                        feeds.forEach((feed: any) => {
                            if (feed && feed.url) {
                                allUrls.push(feed.url.trim());
                            }
                        });
                    }
                }
            }
        }
    }
    return allUrls;
}

export function mapRawItem(item: RawFeedItem | null, fmtFn: (dateStr: string) => string): MappedFeedItem | null {
    if (!item) {
        console.warn("mapRawItem received an undefined or null item. Returning null.");
        return null;
    }
    const parser = new DOMParser();
    const doc = parser.parseFromString(item.description || "", "text/html");

    const images = doc.querySelectorAll("img");
    let imgSrc = "";
    
    if (images.length > 0) {
        const firstImg = images[0];
        imgSrc = firstImg.getAttribute('src') || "";
        
        // Find if this image should be removed from the description (prevent duplicate)
        // Check if it's the first child, or the first child of the first child (if it's a link)
        let shouldRemove = false;
        const firstChild = doc.body.firstElementChild;
        if (firstImg === firstChild) shouldRemove = true;
        else if (firstChild?.tagName === 'A' && firstImg === firstChild.firstElementChild) shouldRemove = true;
        else if (firstChild?.tagName === 'P' && firstImg === firstChild.firstElementChild) shouldRemove = true;
        else if (firstChild?.tagName === 'DIV' && firstImg === firstChild.firstElementChild) shouldRemove = true;

        if (shouldRemove || images.length === 1) {
            firstImg.remove();
        }
    }

    // Set lazy loading for any remaining images
    // Remove onload as it doesn't execute in x-html
    doc.querySelectorAll("img").forEach(img => {
        img.setAttribute('loading', 'lazy');
    });

    let sourceUrl = "";
    // Only remove if it explicitly has the source-url class
    const sourceEl = doc.querySelector(".source-url");
    if (sourceEl) {
        sourceUrl = sourceEl.textContent?.trim() || "";
        sourceEl.remove();
    } else {
        sourceUrl = (item as any).source || (item.link ? new URL(item.link).hostname : "");
    }

    // Cleanup gaps: remove empty top-level tags and leading breaks
    let html = doc.body.innerHTML.trim();
    html = html.replace(/^<br\s*\/?>/i, ''); // Leading break
    html = html.replace(/<p><\/p>/gi, '');   // Empty paragraphs
    html = html.replace(/<div><\/div>/gi, ''); // Empty divs
    
    const descContent = html.trim();
    const ts = Date.parse(item.pubDate) || 0;

    return {
        guid: item.guid,
        image: imgSrc || (item as any).image || "",
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
 * @param {boolean} [isOnlineOverride] - Optional override for online status (useful for pre-generation).
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of full item objects for the new deck.
 */
export async function generateNewDeck(
    allFeedItems: MappedFeedItem[],
    readItems: (ReadItem | string)[], // Can be ReadItem objects or just GUID strings (legacy)
    starredItems: (StarredItem | string)[], // Can be StarredItem objects or just GUID strings (legacy)
    shuffledOutItems: (DeckItem | string | ShuffledOutItem)[], // Can be DeckItem objects or just GUID strings (legacy)
    filterMode: string,
    isOnlineOverride?: boolean
): Promise<MappedFeedItem[]> {
    console.log("ENTERING generateNewDeck with filterMode:", filterMode, "isOnlineOverride:", isOnlineOverride);
    console.log("generateNewDeck: allFeedItems count:", allFeedItems.length);
    console.log("generateNewDeck: readItems count:", readItems.length);
    try {
        const MAX_DECK_SIZE = 10;

        // Fetch blacklist from DB
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
            const guids = arr.map(item => (typeof item === 'object' && 'guid' in item && item.guid ? item.guid.toLowerCase() : (typeof item === 'string' ? item.toLowerCase() : ''))); // Check for 'guid' property
            return new Set(guids.filter((guid): guid is string => Boolean(guid))); // Filter out any non-string/empty values
        };

        const allFeedGuidsSet = new Set(allFeedItems.map(item => item.guid));

        const readGuidsSet = new Set([...getGuidSet(readItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const starredGuidsSet = new Set([...getGuidSet(starredItems)].filter(guid => allFeedGuidsSet.has(guid)));
        const shuffledOutGuidsSet = new Set([...getGuidSet(shuffledOutItems)].filter(guid => allFeedGuidsSet.has(guid)));
        
        console.log(`[generateNewDeck] readGuidsSet size: ${readGuidsSet.size}`);
        console.log(`[generateNewDeck] shuffledOutGuidsSet size: ${shuffledOutGuidsSet.size}`);

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
                // 1. Unread AND Unshuffled AND Not Blacklisted
                filteredItems = allFeedItems.filter(item =>
                    !readGuidsSet.has(item.guid) &&
                    !shuffledOutGuidsSet.has(item.guid) &&
                    !isBlacklisted(item)
                );
                
                // 2. Fallback: Any Unread AND Not Blacklisted
                if (filteredItems.length === 0) {
                    console.log('generateNewDeck: No unread/unshuffled items found, trying any unread items.');
                    filteredItems = allFeedItems.filter(item => !readGuidsSet.has(item.guid) && !isBlacklisted(item));
                }

                // 3. Fallback: Any Unshuffled AND Not Blacklisted
                if (filteredItems.length === 0) {
                    console.log('generateNewDeck: No unread items found, trying all unshuffled items.');
                    filteredItems = allFeedItems.filter(item => !shuffledOutGuidsSet.has(item.guid) && !isBlacklisted(item));
                }

                // 4. Ultimate Fallback: Absolutely everything (Still not blacklisted)
                if (filteredItems.length === 0) {
                    console.log('generateNewDeck: Absolutely no filter matches, using all non-blacklisted items.');
                    filteredItems = allFeedItems.filter(item => !isBlacklisted(item));
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

        const isOnline = (typeof isOnlineOverride === 'boolean') ? isOnlineOverride : navigator.onLine;

        if (isOnline) {
            const now = Date.now();
            const hasHyperlink = (item: MappedFeedItem) => /<a\s+href=/i.test(item.description || '');
            const hasQuestionMarkInTitle = (item: MappedFeedItem) => item.title?.includes('?');
            const hasQuestionMarkInDescriptionFirst150 = (item: MappedFeedItem) => (item.description || '').length >= 150 && item.description.substring(0, 150).includes('?');
            const hasQuestionMarkInDescriptionLast150 = (item: MappedFeedItem) => {
                const desc = item.description || '';
                return desc.length >= 150 && desc.substring(desc.length - 150).includes('?');
            };
            // Fallback to flags if description is missing (for items synced by GUID only)
            const hasQuestion = (item: MappedFeedItem) => (item as any).hasQuestion || hasQuestionMarkInTitle(item) || hasQuestionMarkInDescriptionFirst150(item) || hasQuestionMarkInDescriptionLast150(item);
            const hasImage = (item: MappedFeedItem) => (item as any).hasImage || item.image !== "";
            
            const isLongItem = (item: MappedFeedItem) => (item.description || '').length >= 750;
            const isShortItem = (item: MappedFeedItem) => (item.description || '').length > 0 && (item.description || '').length < 750;

            const recentItems = filteredItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);
            addItemsFromCategory(recentItems, 2);
            console.log(`[generateNewDeck] After recentItems: ${nextDeckItems.length}`);

            const itemsWithLinks = filteredItems.filter(hasHyperlink);
            addItemsFromCategory(itemsWithLinks, 1);
            console.log(`[generateNewDeck] After itemsWithLinks: ${nextDeckItems.length}`);

            const itemsWithQuestion = filteredItems.filter(hasQuestion);
            addItemsFromCategory(itemsWithQuestion, 3);
            console.log(`[generateNewDeck] After itemsWithQuestion: ${nextDeckItems.length}`);

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
                    shuffledOutGuidsSet.has(item.guid) && !readGuidsSet.has(item.guid) && !selectedIds.has(item.guid) && !isBlacklisted(item)
                );
                resurfaceCandidates.sort((a, b) => a.timestamp - b.timestamp);

                for (const candidate of resurfaceCandidates) {
                    if (nextDeckItems.length >= MAX_DECK_SIZE) break;
                    tryAddItemToDeck(candidate);
                }
                console.log(`[generateNewDeck] After resurfaceCandidates: ${nextDeckItems.length}`);

                if (nextDeckItems.length < MAX_DECK_SIZE) {
                    const remainingAllItems = allFeedItems.filter(item => 
                        !selectedIds.has(item.guid) && 
                        (filterMode !== 'unread' || !readGuidsSet.has(item.guid)) &&
                        !isBlacklisted(item)
                    );
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

        return shuffleArray([...nextDeckItems]);

    } catch (error) {
        console.error("An error occurred during deck generation:", error);
        return [];
    }
}