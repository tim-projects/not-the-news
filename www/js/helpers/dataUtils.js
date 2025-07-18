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
        console.log("Current deck is empty or invalid. Generating a new deck...");
        await loadNextDeck(app); // Call the shared loadNextDeck, passing app scope
    } else if (validGuidsInDeck.length !== app.currentDeckGuids.length) {
        // If some items were removed from the deck, update and save it
        console.log("Current deck contained hidden/non-existent items. Updating the deck.");
        app.currentDeckGuids = validGuidsInDeck;
        await saveCurrentDeck(db, app.currentDeckGuids);
    }
}

/**
 * Loads the next set of unread items into the current deck.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function loadNextDeck(app) {
    const db = await dbPromise;
    // Ensure entries is up-to-date and correctly mapped before filtering
    await app.loadFeedItemsFromDB(); // Call helper to populate app.entries

    const hiddenSet = new Set(app.hidden.map(h => h.id));

    // Filter from app.entries (which uses 'id'), not raw 'allItems' from DB
    const unreadItems = app.entries.filter(item => !hiddenSet.has(item.id)) // Filter using item.id
                                    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));

    const nextDeck = unreadItems.slice(0, 10); // Take the next 10 items

    if (nextDeck.length > 0) {
        app.currentDeckGuids = nextDeck.map(item => item.id); // Map using item.id
        await saveCurrentDeck(db, app.currentDeckGuids); // Save the new deck
    } else {
        app.currentDeckGuids = []; // Clear the deck if no more unread items
        await saveCurrentDeck(db, []); // Persist empty deck
        createAndShowSaveMessage('No more unread items to load!', 'info');
    }

    app.updateCounts();
    app.scrollToTop();
    app.isShuffled = true;
}

/**
 * Shuffles all unhidden items and loads a new deck from them.
 * Decrements the daily shuffle count.
 * @param {object} app The Alpine.js app scope (`this` from Alpine.data).
 */
export async function shuffleFeed(app) {
    if (app.shuffleCount <= 0) {
        createAndShowSaveMessage('No shuffles left for today!', 'error'); // Use UI feedback
        return;
    }

    const db = await dbPromise;
    await app.loadFeedItemsFromDB(); // Ensure entries is up-to-date

    const allUnhidden = app.entries.filter(entry => !app.hidden.some(h => h.id === entry.id));

    console.log(`Total unhidden items: ${allUnhidden.length}`);

    let eligibleItemsForShuffle = allUnhidden;

    if (!navigator.onLine) {
        console.log("App is offline. Filtering for long-form text posts.");
        const longFormItems = allUnhidden.filter(item => item.description.length >= 750 && !item.description.substring(item.description.length - 100).includes('?'));
        if (longFormItems.length < 10) {
            eligibleItemsForShuffle = allUnhidden; // Relax the filter
            console.log("Relaxing filter because less than 10 long-form items are available.");
        } else {
            eligibleItemsForShuffle = longFormItems;
        }
        console.log(`Number of long-form items: ${eligibleItemsForShuffle.length}`);
    }

    if (eligibleItemsForShuffle.length === 0) {
        createAndShowSaveMessage('No unread items to shuffle.', 'info'); // Use UI feedback
        return;
    }

    const shuffledEligibleItems = shuffleArray(eligibleItemsForShuffle);
    const newDeckItems = shuffledEligibleItems.slice(0, 10); // Get the first 10 shuffled items

    app.currentDeckGuids = newDeckItems.map(item => item.id);
    await saveCurrentDeck(db, app.currentDeckGuids); // Save the new shuffled deck

    app.shuffleCount--;
    const today = new Date();
    today.setHours(0,0,0,0);
    await saveShuffleState(db, app.shuffleCount, today); // Save updated shuffle state

    app.updateCounts();
    app.scrollToTop();
    app.isShuffled = true;
}