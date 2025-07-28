import {
    performFeedSync,
    performFullSync,
    pullUserState,
    processPendingOperations,
    loadSimpleState,
    loadArrayState,
    isOnline,
    initDb,
    saveSimpleState // Import saveSimpleState, as it was missing for some watches
} from './data/database.js';
import { loadConfigFile, saveConfigFile } from './helpers/apiUtils.js';
import { formatDate, mapRawItems, validateAndRegenerateCurrentDeck, loadNextDeck, shuffleFeed } from './helpers/dataUtils.js';
import { toggleStar, toggleHidden, pruneStaleHidden, loadCurrentDeck, saveCurrentDeck, loadShuffleState, saveShuffleState, setFilterMode, loadFilterMode } from './helpers/userStateUtils.js';
import { initSyncToggle, initImagesToggle, initTheme, initScrollPosition, initShuffleCount, initConfigPanelListeners } from './ui/uiInitializers.js';
import { updateCounts, manageSettingsPanelVisibility, scrollToTop, attachScrollToTopHandler, saveCurrentScrollPosition, createStatusBarMessage } from './ui/uiUpdaters.js';

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
        // Modify existing property and add new ones
        loading: true, // Changed from appInitialized: false
        deck: [], // New property to hold feed items for display
        feedItems: {}, // New property for local cache of all fetched feed items by GUID

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
        entries: [], // Note: this will still hold all items from loadFeedItemsFromDB for internal processing
        hidden: [],
        starred: [],
        currentDeckGuids: [],
        errorMessage: '',
        isOnline: isOnline(),
        deckItems: [], // This property seems redundant with 'deck' now. Consider consolidating or removing if not used elsewhere.
        _lastFilterHash: '',
        _cachedFilteredEntries: null,

        // New method to load and display the current deck
        async loadAndDisplayDeck() {
            console.log('Loading current deck and populating display...');
            const currentDeckGuids = await loadCurrentDeck(); // from userStateUtils.js
            if (currentDeckGuids && currentDeckGuids.length > 0) {
                const db = await getDb(); // Get db instance for direct feedItems store access
                const tx = db.transaction('feedItems', 'readonly');
                const store = tx.objectStore('feedItems');
                const itemPromises = currentDeckGuids.map(guid => store.get(guid));
                const items = await Promise.all(itemPromises);
                this.deck = items.filter(item => item !== undefined); // Filter out any items not found
                console.log(`Populated deck with ${this.deck.length} items.`);
            } else {
                this.deck = []; // Ensure deck is empty if no GUIDs
                console.log('Current deck GUIDs is empty. Displaying an empty deck.');
            }
        },

        // Modified filteredEntries getter
        get filteredEntries() {
            // Only return items when not loading, and the deck is populated
            if (this.loading || !this.deck || this.deck.length === 0) {
                console.log('filteredEntries: App not ready or deck is empty, returning empty array.');
                return [];
            }
            // For now, return the raw deck. Filtering logic can be re-introduced later if needed.
            console.log(`filteredEntries: Returning ${this.deck.length} items from deck.`);
            return this.deck;
        },

        async initApp() {
            // console.log('initApp has been called from x-init!'); // Removed as per instructions

            try {
                this.db = await initDb();
                // console.log("IndexedDB initialized within initApp()."); // Removed as per instructions

                this.syncEnabled = (await loadSimpleState('syncEnabled')).value;
                this.imagesEnabled = (await loadSimpleState('imagesEnabled')).value;
                this.openUrlsInNewTabEnabled = (await loadSimpleState('openUrlsInNewTabEnabled')).value;
                this.filterMode = (await loadFilterMode());
                this.isOnline = isOnline();

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

                // This is still needed to populate this.entries for internal processing (like pruneStaleHidden)
                await this.loadFeedItemsFromDB();

                this.hidden = (await loadArrayState('hidden')).value;
                this.starred = (await loadArrayState('starred')).value;

                const itemsCount = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').count();
                let lastFeedSyncServerTime;

                if (itemsCount === 0 && this.isOnline) {
                     await performFullSync(); // This also updates lastFeedSync
                     // Read from DB after full sync (which calls performFeedSync internally).
                     lastFeedSyncServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                     
                     if (this.syncEnabled && this.isOnline) {
                         await pullUserState();
                         this.hidden = (await loadArrayState('hidden')).value;
                         this.starred = (await loadArrayState('starred')).value;
                     }
                     await this.loadFeedItemsFromDB(); // Re-load entries after full sync
                }

                // Use lastFeedSyncServerTime directly
                this.hidden = await pruneStaleHidden(this.entries, lastFeedSyncServerTime);

                // Ensure currentDeckGuids is loaded and valid after sync
                this.currentDeckGuids = await loadCurrentDeck();
                await validateAndRegenerateCurrentDeck(this);

                // --- NEW: Load and display the deck from DB after sync and validation ---
                await this.loadAndDisplayDeck();

                const { shuffleCount, lastShuffleResetDate } = await loadShuffleState();
                const today = new Date();
                today.setHours(0,0,0,0);
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
                            this.rssFeedsInput = (await loadConfigFile('rssFeeds.txt')).content || '';
                        } catch (e) {
                            console.warn("Failed to load rssFeeds.txt from server, falling back to local storage:", e);
                            this.rssFeedsInput = (await loadSimpleState('rssFeeds')).value || '';
                        }
                        try {
                            this.keywordBlacklistInput = (await loadConfigFile('keywordBlacklist.txt')).content || '';
                        }
                        catch (e) {
                            console.warn("Failed to load keywordBlacklist.txt from server, falling back to local storage:", e);
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

                // Set loading to false only after the deck is populated and ready for display
                this.loading = false;
                // this.appInitialized = true; // Removed as per instructions

                if (this.syncEnabled) {
                    setTimeout(async () => {
                        try {
                            console.log("Initiating background partial sync...");
                            await performFeedSync(this); 
                            const currentFeedServerTime = (await loadSimpleState('lastFeedSync')).value || Date.now();
                            
                            await pullUserState();
                            this.hidden = (await loadArrayState('hidden')).value;
                            this.starred = (await loadArrayState('starred')).value;
                            await this.loadFeedItemsFromDB(); // Reload all entries
                            this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                            await validateAndRegenerateCurrentDeck(this); // Re-validate and regenerate deck if needed
                            await this.loadAndDisplayDeck(); // Reload the displayed deck
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
                        this.hidden = (await loadArrayState('hidden')).value;
                        this.starred = (await loadArrayState('starred')).value;
                        await this.loadFeedItemsFromDB(); // Reload all entries
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await validateAndRegenerateCurrentDeck(this); // Re-validate and regenerate deck if needed
                        await this.loadAndDisplayDeck(); // Reload the displayed deck
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
                        await this.loadFeedItemsFromDB(); // Reload all entries
                        this.hidden = await pruneStaleHidden(this.entries, currentFeedServerTime);
                        await validateAndRegenerateCurrentDeck(this); // Re-validate and regenerate deck if needed
                        await this.loadAndDisplayDeck(); // Reload the displayed deck
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
                // this.appInitialized = true; // Removed as per instructions
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
                return;
            }
            const rawItemsFromDb = await this.db.transaction('feedItems', 'readonly').objectStore('feedItems').getAll();
            // Populate the feedItems cache for quick lookup
            this.feedItems = {};
            rawItemsFromDb.forEach(item => {
                this.feedItems[item.guid] = item;
            });
            this.entries = mapRawItems(rawItemsFromDb, formatDate);
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
        async toggleStar(guid) {
            await toggleStar(this, guid);
        },
        isHidden(guid) {
            return this.hidden.some(e => e.id === guid);
        },
        async toggleHidden(guid) {
            console.log("toggleHidden called with guid:", guid);
            await toggleHidden(this, guid);
            await validateAndRegenerateCurrentDeck(this);
            await this.loadAndDisplayDeck(); // Reload displayed deck after hidden state changes
        },
        setFilter(mode) {
            this.filterMode = mode;
        },
        async loadNextDeck() {
            await loadNextDeck(this);
            await this.loadAndDisplayDeck(); // Reload displayed deck after loading next deck
        },

        async shuffleFeed() {
            await shuffleFeed(this);
            await this.loadAndDisplayDeck(); // Reload displayed deck after shuffle
        },

        async saveRssFeeds() {
            await saveConfigFile('rssFeeds.txt', this.rssFeedsInput);
            createStatusBarMessage('RSS Feeds saved!', 'success');
            this.loading = true; // Re-enable loading state during sync
            await performFullSync();
            await this.loadFeedItemsFromDB();
            await validateAndRegenerateCurrentDeck(this);
            await this.loadAndDisplayDeck(); // Reload the displayed deck
            this.loading = false; // Disable loading state after sync
        },

        async saveKeywordBlacklist() {
            await saveConfigFile('keywordBlacklist.txt', this.keywordBlacklistInput);
            createStatusBarMessage('Keyword Blacklist saved!', 'success');
            // This might cause filteredEntries to recompute, but doesn't necessarily reload the deck.
            // If the filteredEntries relied on this.entries (which it still does for pruneStaleHidden),
            // it will naturally update.
            this.updateCounts(); 
        }
    }));
});