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
    saveSimpleState
} from './data/database.js';
import { loadConfigFile, saveConfigFile } from './helpers/apiUtils.js';
// Removed 'displayCurrentDeck' from dataUtils.js imports as it will be removed/refactored there
import { formatDate, mapRawItem, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
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
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js'

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
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
        errorMessage: '',
        isOnline: isOnline(),
        _lastFilterHash: '',
        _cachedFilteredEntries: null,

        // New method to load and display the current deck
        async loadAndDisplayDeck() {
            console.log("Loading current deck and populating display (app.js:loadAndDisplayDeck)...");
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
            // --- INSERT NEW CODE BELOW THIS LINE ---
            const seenGuidsForDeck = new Set(); // To track unique items added to the deck.
            // --- END INSERT NEW CODE ---

            if (guidsToDisplay && Array.isArray(guidsToDisplay)) { // Existing line, keep this.
                for (const guid of guidsToDisplay) { // Existing line, keep this.
                    // --- MODIFY THE IF/ELSE IF/ELSE BLOCK BELOW ---
                    // Replace the entire content of this `for` loop (the if/else if/else block) with:
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
            if (this.loading || !this.deck || this.deck.length === 0) {
                console.log('filteredEntries: App not ready or deck is empty, returning empty array.');
                return [];
            }
            console.log(`filteredEntries: Returning ${this.deck.length} items from deck.`);
            return this.deck;
        } /* No comma needed here if this is the last getter/property before a method */ ,

        async initApp() {
            try {
                this.db = await initDb();

                this.syncEnabled = (await loadSimpleState('syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState('imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState('openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode());
                this.isOnline = isOnline();

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

                this.hidden = (await loadArrayState('hidden')).value;
                this.starred = (await loadArrayState('starred')).value;

                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                if (itemsCount === 0 && this.isOnline) {
                    await performFullSync(this);
                    lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                    // Re-load state after full sync
                    await this.loadFeedItemsFromDB();
                    this.hidden = (await loadArrayState('hidden')).value;
                    this.starred = (await loadArrayState('starred')).value;
                }

                this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);

                // --- IMPORTANT FIX START ---
                // Load currentDeckGuids and ensure they are always strings (GUIDs)
                let storedGuidsResult = await loadCurrentDeck(); // loadCurrentDeck internally uses loadSimpleState
                this.currentDeckGuids = (storedGuidsResult || []).map(item => {
                    // If 'item' is an object with an 'id' property, use item.id, otherwise use the item itself (assuming it's already a string)
                    return typeof item === 'object' && item !== null && item.id ? item.id : String(item);
                });
                // --- IMPORTANT FIX END ---

                // validateAndRegenerateCurrentDeck will update this.currentDeckGuids, which triggers the $watch and then loadAndDisplayDeck()
                await validateAndRegenerateCurrentDeck(this);

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState();
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (lastShuffleResetDate && new Date(lastShuffleResetDate).toDateString() === today.toDateString()) {
                    this.shuffleCount = shuffleCount;
                } else {
                    this.shuffleCount = 2;
                    await saveShuffleState(2, today);
                }

                initTheme(this);
                initSyncToggle(this);
                initImagesToggle(this);
                initShuffleCount(this);
                initConfigPanelListeners(this);

                this.$watch("openSettings", async (isOpen) => {
                    if (isOpen) {
                        this.modalView = 'main';
                        await manageSettingsPanelVisibility(this);
                        try {
                            // Corrected file path from rssFeeds.txt to feeds.txt
                            this.rssFeedsInput = (await loadConfigFile('feeds.txt')).content || '';
                        } catch (e) {
                            console.warn("Failed to load feeds.txt from server, falling back to local storage:", e);
                            this.rssFeedsInput = (await loadSimpleState('rssFeeds')).value || '';
                        }
                        try {
                            // Corrected file path from keywordBlacklist.txt to filter_keywords.txt
                            this.keywordBlacklistInput = (await loadConfigFile('filter_keywords.txt')).content || '';
                        } catch (e) {
                            console.warn("Failed to load filter_keywords.txt from server, falling back to local storage:", e);
                            this.keywordBlacklistInput = (await loadSimpleState('keywordBlacklist')).value || '';
                        }
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
                this.$watch('filterMode', value => setFilterMode(this, value));
                this.updateCounts();
                await initScrollPosition(this);

                this.loading = false; // Set loading to false after everything is ready

                // Initial load of the deck, triggered once after init
                // The $watch on currentDeckGuids handles this automatically after validateAndRegenerateCurrentDeck.
                // We don't need an explicit call here unless currentDeckGuids *starts* empty and needs initial population.
                // Since validateAndRegenerateCurrentDeck always tries to populate it, this explicit call is redundant
                // and might even cause double loading if currentDeckGuids is already set.
                // If you *must* have an initial display before any changes, ensure currentDeckGuids is correctly set by
                // validateAndRegenerateCurrentDeck before this point, and the $watch will handle it.
                // For now, removing this redundant call.
                // if (this.currentDeckGuids.length > 0 || this.entries.length > 0) {
                //     await this.loadAndDisplayDeck();
                // } else {
                //     console.log("No initial GUIDs or entries to load. Deck will remain empty.");
                // }


                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(this);
                            const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();

                            await pullUserState();
                            // Re-load hidden/starred after pullUserState
                            this.hidden = (await loadArrayState('hidden')).value;
                            this.starred = (await loadArrayState('starred')).value;
                            await this.loadFeedItemsFromDB(); // Refresh feedItems cache
                            this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                            await validateAndRegenerateCurrentDeck(this); // This will update currentDeckGuids, triggering the $watch
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
                        this.hidden = (await loadArrayState('hidden')).value;
                        this.starred = (await loadArrayState('starred')).value;
                        await this.loadFeedItemsFromDB(); // Refresh feedItems cache
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await validateAndRegenerateCurrentDeck(this); // This will update currentDeckGuids, triggering the $watch
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
                        await validateAndRegenerateCurrentDeck(this); // This will update currentDeckGuids, triggering the $watch
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
            const rawItemsFromDb = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();

            this.feedItems = {}; // Clear previous cache
            // --- INSERT NEW CODE BELOW THIS LINE ---
            const uniqueEntries = [];
            const seenGuids = new Set();
            // --- END INSERT NEW CODE ---

            rawItemsFromDb.forEach(item => {
                // --- MODIFY THE IF CONDITION AND CONTENT BELOW ---
                if (item && item.guid && !seenGuids.has(item.guid)) {
                    this.feedItems[item.guid] = item;
                    uniqueEntries.push(item); // Add to a temporary unique array
                    seenGuids.add(item.guid);
                } else if (item && item.guid && seenGuids.has(item.guid)) {
                    console.warn(`Duplicate GUID found in raw database items during loadFeedItemsFromDB: ${item.guid}. Skipping duplicate.`);
                } else {
                    console.warn('Item or GUID missing when processing raw database items. Skipping:', item);
                }
                // --- END MODIFY ---
            });

            // --- REPLACE THE LINE THAT SETS this.entries ---
            this.entries = mapRawItems(uniqueEntries, formatDate);
            // --- END REPLACE ---
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
            // validateAndRegenerateCurrentDeck will update currentDeckGuids, triggering the $watch
            await validateAndRegenerateCurrentDeck(this);
        },
        setFilter(mode) {
            this.filterMode = mode;
        },
        async loadNextDeck() {
            // loadNextDeck (from dataUtils) will update this.currentDeckGuids, triggering the $watch
            await loadNextDeck(this);
        },

        async shuffleFeed() {
            // shuffleFeed (from dataUtils) will update this.currentDeckGuids, triggering the $watch
            await shuffleFeed(this);
        },

        async saveRssFeeds() {
            await saveConfigFile('feeds.txt', this.rssFeedsInput); // Corrected to feeds.txt
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true; // Re-enable loading state during sync
            await performFullSync();
            await this.loadFeedItemsFromDB(); // Refresh feedItems cache after full sync
            // validateAndRegenerateCurrentDeck will update currentDeckGuids, triggering the $watch
            await validateAndRegenerateCurrentDeck(this);
            this.loading = false; // Disable loading state after sync
        },

        async saveKeywordBlacklist() {
            await saveConfigFile('filter_keywords.txt', this.keywordBlacklistInput); // Corrected to filter_keywords.txt
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            // This does not directly affect the deck content, only filtering, so no loadAndDisplayDeck needed
            this.updateCounts();
        }
    }));
});