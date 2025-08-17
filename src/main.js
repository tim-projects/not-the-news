// main.js - YOUR ORIGINAL FILE WITH THE MINIMAL NECESSARY FIX

import Alpine from 'alpinejs';

// --- Database Module (Your original, working code) ---
const db = {
    _db: null,
    DB_NAME: 'not-the-news-db',
    DB_VERSION: 25,
    async open() { /* ... unchanged ... */ },
    async get(storeName, key) { /* ... unchanged ... */ },
    async getAll(storeName) { /* ... unchanged ... */ },
    async put(storeName, value, key = null) { /* ... unchanged ... */ }
};

// --- UI Feedback Module (Your original, working code) ---
const ui = {
    _timeoutId: null,
    showStatus(message, duration = 3000) { /* ... unchanged ... */ }
};

// --- Alpine.js Application ---
document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // All state properties are from your original file
        loading: true,
        progressMessage: 'Initializing...',
        openSettings: false,
        modalView: 'main',
        allItems: {},
        starred: [],
        hidden: [],
        currentDeckGuids: [],
        filterMode: 'unread',
        theme: 'dark',
        shuffleCount: 2,
        syncEnabled: true,
        imagesEnabled: true,
        openUrlsInNewTabEnabled: true,
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        rssSaveMessage: '',
        keywordSaveMessage: '',
        
        // Computed State
        get starredGuids() {
            return this.starred.map(item => item.guid);
        },
        get hiddenGuids() {
            return this.hidden.map(item => item.guid);
        },
        get filteredEntries() {
            const deckItems = this.currentDeckGuids
                .map(guid => this.allItems[guid])
                .filter(Boolean);
            
            switch (this.filterMode) {
                case 'starred':
                    return Object.values(this.allItems).filter(item => this.isStarred(item.guid)).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'hidden':
                     return Object.values(this.allItems).filter(item => this.isHidden(item.guid)).sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
                case 'all':
                    return deckItems;
                case 'unread':
                default:
                    return deckItems.filter(item => !this.isHidden(item.guid));
            }
        },

        // Initialization (Your original, working code)
        async initApp() { /* ... unchanged ... */ },
        async loadStateFromDb() { /* ... unchanged ... */ },

        // ======================= START OF THE ONLY FIX =======================
        // State Management & Actions
        isStarred(guid) {
            // FIX: Use .some() to correctly check the array of objects.
            return this.starred.some(item => item.guid === guid);
        },
        isHidden(guid) {
            // FIX: Use .some() to correctly check the array of objects.
            return this.hidden.some(item => item.guid === guid);
        },
        // ======================== END OF THE ONLY FIX ========================

        async toggleStar(guid) {
            // This function was already correctly handling an array of objects.
            const index = this.starred.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.starred.splice(index, 1);
                 ui.showStatus('Item unstarred.');
            } else {
                this.starred.push({ guid, starredAt: new Date().toISOString() });
                 ui.showStatus('Item starred!');
            }
            await db.put('userState', this.starred, 'starred');
        },

        async toggleHidden(guid) {
            // This function was also already correctly handling an array of objects.
            const index = this.hidden.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.hidden.splice(index, 1);
                ui.showStatus('Item un-hidden.');
            } else {
                this.hidden.push({ guid, hiddenAt: new Date().toISOString() });
                ui.showStatus('Item hidden.');
            }
            await db.put('userState', this.hidden, 'hidden');

            const deckIndex = this.currentDeckGuids.indexOf(guid);
            if(deckIndex > -1) {
                this.currentDeckGuids.splice(deckIndex, 1);
                await db.put('userState', this.currentDeckGuids, 'currentDeckGuids');
            }
        },
        
        // All other methods are your original, working code
        toggleTheme() { /* ... unchanged ... */ },
        applyTheme() { /* ... unchanged ... */ },
        async syncFeed() { /* ... unchanged ... */ },
        manageDeck() { /* ... unchanged ... */ },
        processShuffle() { /* ... unchanged ... */ },
        scrollToTop() { /* ... unchanged ... */ },
        handleEntryLinks(element) { /* ... unchanged ... */ }
    }));
});

window.Alpine = Alpine;
Alpine.start();