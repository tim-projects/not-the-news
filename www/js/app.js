// www/js/app.js

import {
    getDb,
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    isOnline,
    initDb,
    saveSimpleState,
    getAllFeedItems
} from './data/database.js';
import { loadConfigFile, saveConfigFile } from './helpers/apiUtils.js';
// Removed 'displayCurrentDeck' from dataUtils.js imports as it will be removed/refactored there
import { formatDate, mapRawItem, mapRawItems } from './helpers/dataUtils.js';
import {
    loadCurrentDeck,
    saveCurrentDeck,
    toggleStar,
    toggleHidden,
    pruneStaleHidden,
    saveShuffleState,
    loadShuffleState,
    setFilterMode,
    loadFilterMode
} from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js'
import { manageDailyDeck, processShuffle } from './helpers/deckManager.js';

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // --- MODIFIED LINE HERE ---
        navigator.serviceWorker.register('/sw.js', { type: 'module', scope: '/' }) // Add type: 'module'
            .then(reg => {
                console.log('Service Worker registered:', reg.scope);

                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    if (newWorker) {
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'activated' && !navigator.serviceWorker.controller) {
                                console.log('New Service Worker activated, but not yet controlling. Reloading...');
                                window.location.reload();
                            }
                        });
                    }
                });
            })
            .catch(error => console.warn('Service Worker registration failed:', error));
    });
}

document.addEventListener("load", e => {
    if (e.target?.tagName?.toLowerCase() === "img") {
        e.target.classList.add("loaded");
    }
}, true);

document.addEventListener('alpine:init', () => {
    if (typeof window.Alpine === 'undefined') {
        console.error("CRITICAL ERROR: window.Alpine is undefined inside alpine:init event listener. Alpine.js might not have loaded correctly.");
        document.getElementById('loading-screen').textContent = 'Error: Alpine.js failed to load.';
        document.getElementById('loading-screen').style.display = 'block';
        return;
    }
    console.log("'alpine:init' event fired. Defining 'rssApp' component.");

    window.Alpine.data('rssApp', () => ({
        loading: true,
        deck: [], // Primary property for displayed items
        feedItems: {}, // Cache of all fetched feed items by GUID
        scrollObserver: null,
        filterMode: 'unread',
        openSettings: false,
        modalView: 'main',
        shuffleCount: 0,
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        entries: [], // All mapped feed items
        hidden: [],
        starred: [],
        currentDeckGuids: [], // This Alpine property holds the array of GUID strings
        shuffledOutGuids: [], // Array to hold GUIDs of items shuffled out
        errorMessage: '',
        isOnline: isOnline(),
        _lastFilterHash: '',
        _cachedFilteredEntries: null,

        // New method to load and display the current deck
        async loadAndDisplayDeck() {
            console.log("Loading current deck and populating display (app.js:loadAndDisplayDeck)...");
            // This method's primary role is to populate 'this.deck' specifically for the 'unread' filter mode.
            // Other filter modes ('all', 'hidden', 'starred') will use 'filteredEntries' directly from 'this.entries'.
            if (this.filterMode !== 'unread') {
                console.log(`loadAndDisplayDeck called, but current filterMode is '${this.filterMode}'. 'this.deck' will still be updated, but 'filteredEntries' will use 'this.entries' directly.`);
            }
            await this.loadFeedItemsFromDB(); // Ensure feedItems is up-to-date and unique. Keep this line.

            const guidsToDisplay = this.currentDeckGuids; // Keep this line.

            console.log("DEBUG app.js: loadAndDisplayDeck - type of guidsToDisplay:", typeof guidsToDisplay, "Array.isArray:", Array.isArray(guidsToDisplay));
            if (Array.isArray(guidsToDisplay)) {
                console.log("DEBUG app.js: loadAndDisplayDeck - first 5 GUIDs:", guidsToDisplay.slice(0, 5));
                console.log("DEBUG app.js: loadAndDisplayDeck - type of first GUID (if any):", guidsToDisplay.length > 0 ? typeof guidsToDisplay[0] : 'N/A');
            }

            const items = []; // Existing line, keep this.
            const hiddenSet = new Set(this.hidden.map(h => h.id)); // Existing line, keep this.
            const starredSet = new Set(this.starred.map(s => s.id)); // Existing line, keep this.
            const seenGuidsForDeck = new Set(); // To track unique items added to the deck.

            if (guidsToDisplay && Array.isArray(guidsToDisplay)) { // Existing line, keep this.
                for (const guid of guidsToDisplay) { // Existing line, keep this.
                    if (typeof guid !== 'string') {
                        console.warn(`Invalid GUID encountered in guidsToDisplay (loadAndDisplayDeck): ${JSON.stringify(guid)}. Skipping.`);
                        continue;
                    }

                    const item = this.feedItems[guid];
                    if (item && item.guid && !seenGuidsForDeck.has(item.guid)) {
                        const mappedItem = mapRawItem(item, formatDate);
                        mappedItem.isHidden = hiddenSet.has(item.guid);
                        mappedItem.isStarred = starredSet.has(item.guid);
                        items.push(mappedItem);
                        seenGuidsForDeck.add(item.guid); // Mark as seen for the deck
                    } else if (item && item.guid && seenGuidsForDeck.has(item.guid)) {
                        console.warn(`Duplicate item (GUID: ${item.guid}) already added to deck. Skipping.`);
                    } else {
                        console.warn(`Feed item with GUID ${guid} not found in feedItems cache or has invalid GUID. Skipping.`);
                    }
                    // --- END MODIFY ---
                }
            }

            this.deck = items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate)); // Existing line, keep this.
            console.log(`Populated deck with ${this.deck.length} items from app.js:loadAndDisplayDeck.`); // Existing line, keep this.
        },

        get filteredEntries() {
            // Calculate a hash to determine if state variables affecting filtering have changed.
            const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.keywordBlacklistInput}-${this.deck.length}`;

            // If the state hasn't changed and we have a cached result, return it for performance.
            if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
                return this._cachedFilteredEntries;
            }

            let filtered = [];
            // Create Sets/Maps for efficient lookup of hidden and starred items.
            const hiddenMap = new Map(this.hidden.map(h => [h.id, h.hiddenAt]));
            const starredMap = new Map(this.starred.map(s => [s.id, s.starredAt]));

            // Apply filtering logic based on the current filterMode.
            switch (this.filterMode) {
                case "unread":
                    // When in "unread" mode, we display the items from the 'deck'.
                    // The 'deck' is specifically populated with unread items via loadAndDisplayDeck.
                    filtered = this.deck;
                    break;
                case "all":
                    // In "all" mode, display all entries.
                    filtered = this.entries;
                    break;
                case "hidden":
                    // In "hidden" mode, filter for items that are present in the 'hidden' array.
                    // Sort them by the time they were hidden, most recent first.
                    filtered = this.entries.filter(e => hiddenMap.has(e.id))
                                           .sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                    break;
                case "starred":
                    // In "starred" mode, filter for items present in the 'starred' array.
                    // Sort them by the time they were starred, most recent first.
                    filtered = this.entries.filter(e => starredMap.has(e.id))
                                           .sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                    break;
                default:
                    // Fallback for any unexpected filter mode, defaulting to "unread".
                    console.warn(`Unknown filterMode: ${this.filterMode}. Defaulting to 'unread'.`);
                    filtered = this.deck;
                    break;
            }

            // Apply the keyword blacklist filter to the result, regardless of the filterMode.
            const keywordBlacklist = this.keywordBlacklistInput.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
            if (keywordBlacklist.length > 0) {
                filtered = filtered.filter(item => {
                    const title = item.title ? item.title.toLowerCase() : '';
                    const description = item.description ? item.description.toLowerCase() : '';
                    // An item is kept if *none* of the blacklisted keywords are found in its title or description.
                    return !keywordBlacklist.some(keyword => title.includes(keyword) || description.includes(keyword));
                });
            }

            // Cache the newly computed result and the hash for future efficiency.
            this._cachedFilteredEntries = filtered;
            this._lastFilterHash = currentHash;
            return filtered;
        }, // IMPORTANT: Ensure this comma is present as it's a property in an object.

        async initApp() {
            try {
                this.db = await initDb();

                this.syncEnabled = (await loadSimpleState('syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState('imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState('openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode());
                this.isOnline = isOnline();
                await this.loadFeedItemsFromDB(); // Refresh feedItems cache after full sync

                // Add the new $watch property here
                this.$watch('currentDeckGuids', async (newGuids, oldGuids) => {
                    // Compare content to avoid unnecessary re-renders if the array reference changes but content is same
                    if (JSON.stringify(newGuids) !== JSON.stringify(oldGuids)) {
                        console.log('currentDeckGuids changed. Triggering loadAndDisplayDeck.');
                        await this.loadAndDisplayDeck();
                    } else {
                        console.log('currentDeckGuids changed, but content is identical. Skipping re-display.');
                    }
                });

                if (this.syncEnabled && this.isOnline) {
                    try {
                        console.log("Attempting early pull of user state (including current deck) from server...");
                        await pullUserState();
                        console.log("Early user state pull completed.");
                    } catch (error) {
                        console.warn("Early pullUserState failed, proceeding with local state. Error:", error);
                        if (error instanceof SyntaxError && error.message.includes('Unexpected end of JSON input')) {
                            console.error("Failed to parse user state JSON. The server likely sent incomplete or malformed data.");
                        }
                    }
                }

                // Ensure feedItems cache is loaded BEFORE hidden/starred for pruneStaleHidden
                await this.loadFeedItemsFromDB();

                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                if (itemsCount === 0 && this.isOnline) {
                    await performFullSync(this);
                    lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                    // Re-load state after full sync
                    await this.loadFeedItemsFromDB();
                }

                this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);
                // NEW: Orchestrate initial deck generation and daily reset
                await manageDailyDeck(this); // Pass 'this' (app scope)

                // Load currentDeckGuids and ensure they are always strings (GUIDs)
                let storedGuidsResult = await loadCurrentDeck(); // loadCurrentDeck internally uses loadSimpleState
                this.currentDeckGuids = (storedGuidsResult || []).map(item => {
                    // If 'item' is an object with an 'id' property, use item.id, otherwise use the item itself (assuming it's already a string)
                    return typeof item === 'object' && item !== null && item.id ? item.id : String(item);
                });


                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this);
                        this.rssFeedsInput = (await loadSimpleState('rssFeeds')).value || '';
                        this.keywordBlacklistInput = (await loadSimpleState('keywordBlacklist')).value || '';
                    } else {
                        await saveCurrentScrollPosition();
                    }
                });
                this.$watch('openUrlsInNewTabEnabled', () => {
                    document.querySelectorAll('.itemdescription').forEach(el => this.handleEntryLinks(el));
                });
                this.$watch("modalView", async () => {
                    await manageSettingsPanelVisibility(this);
                });
                this.$watch('syncEnabled', value => saveSimpleState('syncEnabled', value));
                this.$watch('imagesEnabled', value => saveSimpleState('imagesEnabled', value));
                
                // Custom $watch for filterMode to trigger re-evaluation of displayed items
                this.$watch('filterMode', async (newMode) => {
                    // Update the filter mode in the database for persistence.
                    await setFilterMode(this, newMode);
                    console.log(`Filter mode changed to: ${newMode}`);

                    // If the new mode is 'unread', we need to validate and potentially regenerate the deck.
                    // This action will update `this.currentDeckGuids`, which in turn triggers its own
                    // `$watch` (defined elsewhere in initApp) to call `loadAndDisplayDeck()`.
                    if (newMode === 'unread') {
                        console.log('Filter set to unread. Managing daily deck to populate this.deck.');
                        await manageDailyDeck(this); // NEW CALL
                    } else {
                        // For 'all', 'hidden', or 'starred' modes, the `filteredEntries` computed property
                        // will automatically re-evaluate based on `this.entries` (the full item list).
                        console.log(`Filter set to ${newMode}. The 'filteredEntries' computed property will automatically re-evaluate from all items.`);
                    }

                    // Always update display counts and scroll to the top for a consistent user experience
                    // when the filter mode changes.
                    this.updateCounts();
                    this.scrollToTop();
                });

                this.updateCounts();
                await initScrollPosition(this);

                this.loading = false; // Set loading to false after everything is ready

                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(this);
                            const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                            await pullUserState();
                            // Re-load hidden/starred after pullUserState
                            await this.loadFeedItemsFromDB(); // Refresh feedItems cache
                            this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                            await manageDailyDeck(this); // This will update currentDeckGuids, triggering the $watch
                            this.updateCounts();
                            console.log("Background partial sync completed.");
                        } catch (error) {
                            console.error('Background partial sync failed', error);
                        }
                    }, 0);
                }

                attachScrollToTopHandler();

                window.addEventListener('online', async () => {
                    this.isOnline = true;
                    if (this.syncEnabled) {
                        console.log("Online detected. Processing pending operations and resyncing.");
                        await processPendingOperations();
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        // Re-load hidden/starred after pullUserState
                        await this.loadFeedItemsFromDB(); // Refresh feedItems cache
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await manageDailyDeck(this); // This will update currentDeckGuids, triggering the $watch
                        this.updateCounts();
                        console.log("Online resync completed.");
                    }
                });
                window.addEventListener('offline', () => {
                    this.isOnline = false;
                    console.warn("Offline detected. Syncing disabled.");
                });

                let lastActivityTimestamp = Date.now();
                const recordActivity = () => { lastActivityTimestamp = Date.now(); };
                ["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(event => document.addEventListener(event, recordActivity, true));
                document.addEventListener("visibilitychange", recordActivity, true);
                window.addEventListener("focus", recordActivity, true);

                const SYNC_INTERVAL_MS = 5 * 60 * 1000;
                const INACTIVITY_TIMEOUT_MS = 60 * 1000;

                setInterval(async () => {
                    const now = Date.now();
                    if (!this.isOnline || this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
                        return;
                    }
                    try {
                        console.log("Performing periodic background sync...");
                        await performFeedSync(this);
                        const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                        await pullUserState();
                        await this.loadFeedItemsFromDB(); // Refresh feedItems cache
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await manageDailyDeck(this); // This will update currentDeckGuids, triggering the $watch
                        this.updateCounts();
                        console.log("Periodic background sync completed.");
                    } catch (error) {
                        console.error("Periodic sync failed", error);
                    }
                }, SYNC_INTERVAL_MS);

            } catch (error) {
                console.error("Initialization failed:", error);
                this.errorMessage = "Could not load feed: " + error.message;
                this.loading = false;
            }
        },
        initScrollObserver() {
            const observer = new IntersectionObserver(async (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        const guid = entry.target.dataset.guid;
                        if (guid) {
                            console.log(`Saving scroll position for guid: ${guid}`);
                            await saveSimpleState(`scrollPosition-${guid}`, entry.boundingClientRect.y);
                        }
                    }
                }
            }, {
                root: document.querySelector('#feed-container'),
                rootMargin: '0px',
                threshold: 0.1
            });

            const feedContainer = document.querySelector('#feed-container');

            const observeElements = () => {
                feedContainer.querySelectorAll('[data-guid]').forEach(item => {
                    observer.observe(item);
                });
            };

            observeElements();

            const mutationObserver = new MutationObserver(mutations => {
                console.log('Mutation detected in feed-container. Re-observing elements.');
                observer.disconnect();
                observeElements();
            });

            mutationObserver.observe(feedContainer, { childList: true, subtree: true });

            this.scrollObserver = observer;
        },

        handleEntryLinks(element) {
            if (!element) return;

            const links = element.querySelectorAll('a');

            links.forEach(link => {
                if (link.hostname !== window.location.hostname) {
                    if (this.openUrlsInNewTabEnabled) {
                        link.setAttribute('target', '_blank');
                        link.setAttribute('rel', 'noopener noreferrer');
                    } else {
                        link.removeAttribute('target');
                    }
                }
            });
        },

        async loadFeedItemsFromDB() {
            if (!this.db) {
                console.error("Database not initialized, cannot load feed items.");
                this.entries = [];
                this.feedItems = {};
                return;
            }
            const rawItemsFromDb = await getAllFeedItems();

            this.feedItems = {}; // Clear previous cache
            const uniqueEntries = [];
            const seenGuids = new Set();

            rawItemsFromDb.forEach(item => {
                if (item && item.guid && !seenGuids.has(item.guid)) {
                    this.feedItems[item.guid] = item;
                    uniqueEntries.push(item); // Add to a temporary unique array
                    seenGuids.add(item.guid);
                } else if (item && item.guid && seenGuids.has(item.guid)) {
                    console.warn(`Duplicate GUID found in raw database items during loadFeedItemsFromDB: ${item.guid}. Skipping duplicate.`);
                } else {
                    console.warn('Item or GUID missing when processing raw database items. Skipping:', item);
                }
            });

            this.entries = mapRawItems(uniqueEntries, formatDate);
            this.hidden = (await loadArrayState('hidden')).value;
            this.starred = (await loadArrayState('starred')).value;
        },

        updateCounts() {
            updateCounts(this);
        },

        scrollToTop() {
            scrollToTop();
        },

        isStarred(guid) {
            return this.starred.some(e => e.id === guid);
        },
        // Inserted isHidden method here as per instructions
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        async toggleStar(guid) {
            await toggleStar(this, guid);
            // The deck will be re-rendered via the $watch on currentDeckGuids if toggling affects it (e.g., filterMode)
            // or by subsequent deck operations. No direct loadAndDisplayDeck needed here.
        },
        async toggleHidden(guid) {
            console.log("toggleHidden called with guid:", guid);
            await toggleHidden(this, guid);
            // The deck will be re-evaluated by manageDailyDeck if needed, no direct regeneration here.
            await manageDailyDeck(this); // Trigger deck management to reflect hidden item
        },
        setFilter(mode) {
            this.filterMode = mode;
        },
        async processShuffle() {
            // processShuffle (from deckManager.js) will handle all the logic:
            // decrementing shuffleCount, saving shuffledOutGuids, and updating currentDeckGuids.
            await processShuffle(this); // Pass 'this' (app scope)
        },

        async saveRssFeeds() {
            await saveSimpleState('rssFeeds', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            // Re-fetch feed items and validate deck after saving local RSS feeds.
            // This ensures the UI reflects any changes to the feed source.
            this.loading = true; // Re-enable loading state during data refresh
            await performFullSync(this); // Perform a full sync to update feeds from server if online
            await this.loadFeedItemsFromDB(); // Refresh feedItems cache after potential full sync
            await manageDailyDeck(this); // Update deck based on new feeds
            this.loading = false; // Disable loading state after refresh
        },

        async saveKeywordBlacklist() {
            await saveSimpleState('keywordBlacklist', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            // This affects filtering, so simply update counts and re-evaluate filteredEntries.
            this.updateCounts();
        }
    }));
});