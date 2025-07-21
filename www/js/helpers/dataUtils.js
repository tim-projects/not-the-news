// www/js/helpers/dataUtils.js

// Import necessary modules for deck functions
import { dbPromise, saveStateValue } from '../data/database.js';
import { loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState } from './userStateUtils.js';
import { createAndShowSaveMessage } from '../ui/uiUpdaters.js'; // Assuming this utility is available

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
    // This function remains, as loadNextDeck still uses a partial shuffle logic online
    // and it's a general utility.
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export function mapRawItems(rawList, fmtFn) {
    return rawList.map(item => {
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
    }).sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Updates the UI to display the items in the current deck.
 * This function should be called whenever app.currentDeckGuids is updated
 * and the display needs to be refreshed.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export function displayCurrentDeck(app) {
    // Clear the current displayed items (assuming app.deckItems is what's rendered)
    app.deckItems = [];

    // Populate deckItems based on currentDeckGuids
    app.currentDeckGuids.forEach(guid => {
        const item = app.entries.find(e => e.id === guid);
        if (item) {
            app.deckItems.push(item);
        }
    });

    console.log("Deck displayed:", app.deckItems.map(item => item.title));
    app.scrollToTop(); // Assuming this is a desired behavior for displaying a new deck
}


/**
 * Validates the current deck and regenerates it if all items are hidden or no longer exist.
 * This method is intended to be called during app initialization and after data syncs.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function validateAndRegenerateCurrentDeck(app) {
    const db = await dbPromise;
    const hiddenSet = new Set(app.hidden.map(h => h.id));

    // Filter out items from the current deck that are now hidden or no longer exist in entries
    const validGuidsInDeck = app.currentDeckGuids.filter(guid => {
        const entry = app.entries.find(e => e.id === guid);
        return entry && !hiddenSet.has(guid);
    });

    // If the deck is empty or all items are invalid, generate a new deck
    if (validGuidsInDeck.length === 0 && app.entries.length > 0) {
        console.log("Current deck is empty/invalid. Loading next deck and increasing shuffle count.");
        await loadNextDeck(app); // Call the shared loadNextDeck, passing app scope

        // NEW BEHAVIOR: Increase shuffle count when deck becomes empty due to hiding
        const today = new Date();
        today.setHours(0,0,0,0);
        // Assuming max shuffle count is 2 (initial value)
        if (app.shuffleCount < 2) {
            app.shuffleCount++;
            await saveShuffleState(db, app.shuffleCount, today);
            createAndShowSaveMessage('Shuffle count increased!', 'success');
        } else {
             createAndShowSaveMessage('Shuffle count at maximum.', 'info');
        }

    } else if (validGuidsInDeck.length !== app.currentDeckGuids.length) {
        // If some items were removed from the deck, update and save it
        console.log("Current deck contained hidden/non-existent items. Updating the deck.");
        app.currentDeckGuids = validGuidsInDeck;
        await saveCurrentDeck(db, app.currentDeckGuids);
    }
    displayCurrentDeck(app); // Call displayCurrentDeck after validation/regeneration
}

/**
 * Loads the next set of unread items into the current deck. This logic
 * is now shared by both 'Next Deck' button and 'Shuffle' button behavior,
 * and when the current deck becomes empty.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function loadNextDeck(app) {
    const db = await dbPromise;
    // Ensure entries is up-to-date and correctly mapped before filtering
    await app.loadFeedItemsFromDB(); // Call helper to populate app.entries

    const hiddenSet = new Set(app.hidden.map(h => h.id));

    // Filter out hidden items
    const unreadItems = app.entries.filter(item => !hiddenSet.has(item.id));

    let nextDeck = [];

    if (navigator.onLine) {
        // Online deck creation logic (prioritized items + random fill)
        const longItems = unreadItems.filter(item => item.description.length >= 750);
        const shortItems = unreadItems.filter(item => item.description.length < 750);

        const now = Date.now();
        const recentItems = unreadItems.filter(item => now - item.timestamp <= 24 * 60 * 60 * 1000);

        // Get 2 long items, 2 short items, and 2 recent items
        const numLong = Math.min(2, longItems.length);
        const numShort = Math.min(2, shortItems.length);
        const numRecent = Math.min(2, recentItems.length);

        for (let i = 0; i < numLong; i++) nextDeck.push(longItems[i]);
        for (let i = 0; i < numShort; i++) nextDeck.push(shortItems[i]);
        for (let i = 0; i < numRecent; i++) nextDeck.push(recentItems[i]);

        // Fill the rest with random items from remaining unread items
        const remainingCount = 10 - nextDeck.length;
        const remainingItems = unreadItems.filter(item => !nextDeck.includes(item));
        const shuffledRemaining = shuffleArray(remainingItems).slice(0, remainingCount); // Shuffle for randomness
        nextDeck = nextDeck.concat(shuffledRemaining);

        // If the deck is still not full, fill it with any remaining unread items
        // This ensures a full deck if enough unread items exist
        while (nextDeck.length < 10 && unreadItems.length > nextDeck.length) {
            const item = unreadItems[nextDeck.length]; // This will pick items sequentially from remaining unread
            if (!nextDeck.includes(item)) { // Double check to prevent duplicates if any prior logic accidentally added
                nextDeck.push(item);
            }
        }
    } else {
        // Offline fallback: (Prioritized items + specific filtering/unfiltering)

        let filteredItems = [...unreadItems];

        // Initial filters (remove items with specific patterns)
        const hasQuestionMarkInTitle = (item) => item.title.includes('?');
        const hasQuestionMarkInDescriptionFirst100 = (item) => item.description.substring(0, 100).includes('?');
        const hasQuestionMarkAtEndOfDescription = (item) => item.description.endsWith('?');
        const hasHyperlink = (item) => /<a\s+href=/i.test(item.description);
        const hasImage = (item) => item.image !== "";

        filteredItems = filteredItems.filter(item => !hasQuestionMarkInTitle(item));
        filteredItems = filteredItems.filter(item => !hasQuestionMarkInDescriptionFirst100(item));
        filteredItems = filteredItems.filter(item => !hasQuestionMarkAtEndOfDescription(item));
        filteredItems = filteredItems.filter(item => !(item.description.length >= 750 && hasHyperlink(item)));
        filteredItems = filteredItems.filter(item => !(item.description.length >= 750 && hasImage(item)));

        // Undo filters in reverse priority until we have 10 items
        if (filteredItems.length < 10) {
            let itemsToRestore = unreadItems.filter(item => !filteredItems.includes(item)); // Items not already in filteredItems

            // Restore logic based on priority (reverse of filter application)
            const restoreOrder = [
                (item) => (item.description.length >= 750 && hasImage(item)),
                (item) => (item.description.length >= 750 && hasHyperlink(item)),
                (item) => hasQuestionMarkAtEndOfDescription(item),
                (item) => hasQuestionMarkInDescriptionFirst100(item),
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

        // Sort the resulting deck chronologically for offline consistency
        nextDeck.sort((a, b) => b.timestamp - a.timestamp);
    }

    if (nextDeck.length > 0) {
        app.currentDeckGuids = nextDeck.map(item => item.id); // Map using item.id
        await saveCurrentDeck(db, app.currentDeckGuids); // Save the new deck
    } else {
        app.currentDeckGuids = []; // Clear the deck if no more unread items
        await saveCurrentDeck(db, []); // Persist empty deck
        createAndShowSaveMessage('No more unread items to load!', 'info');
    }

    app.updateCounts();
    displayCurrentDeck(app); // Call displayCurrentDeck after loading a new deck
    app.isShuffled = false; // Reset shuffle state flag, as this isn't a "shuffle" operation itself
}

/**
 * Loads the next set of unread items into the current deck, and decrements the daily shuffle count.
 * This function now uses the same item selection logic as loadNextDeck.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function shuffleFeed(app) {
    if (app.shuffleCount <= 0) {
        const shuffleButton = document.getElementById('shuffle-button'); // Assuming ID exists
        createAndShowSaveMessage(shuffleButton, 'shuffle-error-msg', 'No shuffles left for today!'); // Use UI feedback
        return;
    }

    // Now, shuffleFeed simply triggers the loadNextDeck logic
    // loadNextDeck handles getting the items, updating app.currentDeckGuids,
    // saving to DB, updating counts, and displaying.
    console.log("Shuffle button pressed. Loading next deck and decrementing shuffle count.");
    await loadNextDeck(app);

    // After loadNextDeck completes, handle the shuffle count specific to shuffleFeed
    app.shuffleCount--;
    const today = new Date();
    today.setHours(0,0,0,0);
    const db = await dbPromise; // Need db here for saveShuffleState
    await saveShuffleState(db, app.shuffleCount, today);

    // displayCurrentDeck and updateCounts are already called by loadNextDeck
    // app.scrollToTop() is also called by displayCurrentDeck
    app.isShuffled = true; // Set shuffle state flag
    createAndShowSaveMessage('Feed shuffled!', 'success', 'shuffle-msg'); // Give positive feedback
}