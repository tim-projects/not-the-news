// main.js - FINAL VERSION WITH FETCH CREDENTIALS FIX

import Alpine from 'alpinejs';
import './css/variables.css';
import './css/buttons.css';
import './css/forms.css';
import './css/layout.css';
import './css/content.css';
import './css/modal.css';
import './css/status.css';

const DB_NAME = 'not-the-news-db';
const DB_VERSION = 25;
const STORES = { /* ... unchanged ... */ };
const log = (level, ...args) => { /* ... unchanged ... */ };

// --- Database Operations ---
let db;
async function initDB() { /* ... unchanged ... */ }
async function dbGet(storeName, key) { /* ... unchanged ... */ }
async function dbSet(storeName, key, value) { /* ... unchanged ... */ }
async function dbGetAll(storeName) { /* ... unchanged ... */ }
let statusTimeoutId = null;
function showStatusMessage(message, duration = 3000) { /* ... unchanged ... */ }

// --- Main Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // All state properties are correct from the previous version
        loading: true, progressMessage: 'Initializing...', allItems: {}, currentDeckGuids: [], openSettings: false, modalView: 'main', starred: [], hidden: [], shuffleCount: 2, lastShuffleResetDate: null, shuffledOutGuids: [], filterMode: 'unread', syncEnabled: true, imagesEnabled: true, openUrlsInNewTabEnabled: true, theme: 'dark', rssFeedsInput: '', keywordBlacklistInput: '', rssSaveMessage: '', keywordSaveMessage: '',

        // All computed properties are correct
        get filteredEntries() { /* ... unchanged ... */ },

        // --- Methods ---
        async initApp() { /* ... unchanged ... */ },
        async loadAllUserState() { /* ... unchanged ... */ },
        applyTheme() { /* ... unchanged ... */ },
        async toggleTheme() { /* ... unchanged ... */ },
        async toggleStar(guid) { /* ... unchanged ... */ },
        async toggleHidden(guid) { /* ... unchanged ... */ },
        isStarred(guid) { /* ... unchanged ... */ },
        isHidden(guid) { /* ... unchanged ... */ },
        async manageDeck() { /* ... unchanged ... */ },
        async nextDeck() { /* ... unchanged ... */ },
        async processShuffle() { /* ... unchanged ... */ },
        getRandomGuids(guidArray, count) { /* ... unchanged ... */ },
        async backgroundSync() { /* ... unchanged ... */ },

        async syncFeed() {
            log('sync', 'Fetching feed from server...');
            try {
                // START OF FIX
                const response = await fetch('/api/feed-guids', { credentials: 'same-origin' });
                // END OF FIX
                if (!response.ok) throw new Error(`Failed to fetch feed GUIDs. Status: ${response.status}`);
                const { guids: serverGuids } = await response.json();

                const localGuids = (await dbGetAll(STORES.feedItems)).map(item => item.guid);
                const newGuids = serverGuids.filter(guid => !localGuids.includes(guid));

                if (newGuids.length > 0) {
                    log('sync', `Found ${newGuids.length} new items. Fetching full data...`);
                    // START OF FIX
                    const itemsResponse = await fetch('/api/feed-items', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guids: newGuids }),
                        credentials: 'same-origin'
                    });
                    // END OF FIX
                    if (!itemsResponse.ok) throw new Error('Failed to fetch new items');
                    const newItems = await itemsResponse.json();

                    const tx = db.transaction(STORES.feedItems, 'readwrite');
                    for (const item of newItems) {
                        tx.objectStore(STORES.feedItems).put(item);
                    }
                    await new Promise(resolve => tx.oncomplete = resolve);
                    log('sync', `Successfully stored ${newItems.length} new items.`);
                } else {
                    log('sync', 'No new feed items found.');
                }
                 await this.manageDeck();
            } catch (error) {
                log('sync', 'Feed sync failed:', error);
                showStatusMessage('Feed sync failed.', 3000);
            }
        },
        
        async queueSync(type, data) { /* ... unchanged ... */ },

        async syncUserState() {
             if (!navigator.onLine) {
                showStatusMessage('Offline. Changes saved locally.', 3000);
                return;
            }
            log('sync', 'Syncing user state with server...');
            const ops = await dbGetAll(STORES.pendingOperations);
            if (ops.length === 0) {
                log('sync', 'No pending operations to sync.');
                return;
            }

            try {
                // START OF FIX
                const response = await fetch('/api/user-state', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(ops),
                    credentials: 'same-origin'
                });
                // END OF FIX
                if (!response.ok) throw new Error(`Server responded with ${response.status}`);
                
                const tx = db.transaction(STORES.pendingOperations, 'readwrite');
                tx.objectStore(STORES.pendingOperations).clear();
                await new Promise(resolve => tx.oncomplete = resolve);

                log('sync', `Successfully synced ${ops.length} operations.`);
                showStatusMessage('Changes synced.', 2000);

            } catch (error) {
                log('sync', 'User state sync failed:', error);
                showStatusMessage('Sync failed. Retrying later.', 3000);
            }
        },

        handleEntryLinks(element) { /* ... unchanged ... */ },
        scrollToTop() { /* ... unchanged ... */ }
    }));
});

window.Alpine = Alpine;
Alpine.start();