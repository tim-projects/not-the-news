/**
 * @filepath: src/main.js
 * --- MINIMAL DEBUGGING VERSION ---
 * This version bypasses all complex data loading to ensure the UI can be displayed.
 * It uses dummy data to confirm the Alpine.js component is working.
 */

document.addEventListener('alpine:init', () => {
    Alpine.data('rssApp', () => ({
        // --- UI State Properties ---
        loading: true,
        progressMessage: 'Starting...',
        openSettings: false,
        modalView: 'main',

        // --- State Properties (FIX APPLIED HERE) ---
        // The original error is fixed by initializing these as empty arrays.
        // This is the only part of the previous fix we are keeping.
        allEntries: [],
        currentDeckGuids: [],
        shuffledOutGuids: [],
        starred: [],
        hidden: [],
        rssFeeds: [],
        keywordBlacklist: [],
        
        // Default values for other settings
        shuffleCount: 0,
        openUrlsInNewTabEnabled: true,
        filterMode: 'unread',
        syncEnabled: true,
        imagesEnabled: true,
        theme: 'dark', // Default theme

        // --- Temporary state for settings modal inputs ---
        rssFeedsInput: '',
        keywordBlacklistInput: '',
        rssSaveMessage: '',
        keywordSaveMessage: '',

        // --- Getters (Computed Properties) ---
        get filteredEntries() {
            const starredGuids = this.starred.map(s => s.guid);
            const hiddenGuids = this.hidden.map(h => h.guid);

            switch (this.filterMode) {
                case 'starred':
                    return this.allEntries.filter(entry => starredGuids.includes(entry.guid));
                case 'hidden':
                    return this.allEntries.filter(entry => hiddenGuids.includes(entry.guid));
                case 'all':
                    return this.allEntries;
                case 'unread':
                default:
                    return this.allEntries.filter(entry => 
                        !starredGuids.includes(entry.guid) && !hiddenGuids.includes(entry.guid)
                    );
            }
        },

        // --- Core Methods ---

        /**
         * A minimal init function that loads dummy data and shows the UI.
         */
        initApp() {
            console.log("[Debug] Running minimal initApp().");
            this.progressMessage = 'Applying theme...';
            this.applyTheme();

            this.progressMessage = 'Loading dummy data...';
            this.loadDummyData(); // Load fake data to display something

            this.progressMessage = 'Finalizing UI...';
            this.loading = false; // Immediately hide the loading screen
            console.log("[Debug] UI should now be visible with dummy data.");
        },

        /**
         * Loads fake data to test the UI rendering.
         */
        loadDummyData() {
            this.allEntries = [
                { 
                    guid: 'dummy1', 
                    title: '<h1>Dummy Article One</h1><h2>This is a test</h2>', 
                    description: 'The UI is now loading. This confirms that the data loading process was the issue.',
                    image: 'https://via.placeholder.com/600x338.png/2a2a2e/ffffff?text=Test+Image+1', 
                    source: 'Debug System', 
                    pubDate: new Date().toLocaleString()
                },
                { 
                    guid: 'dummy2', 
                    title: '<h1>Second Dummy Post (Starred)</h1>', 
                    description: 'The next step is to restore your original data loading functions.',
                    image: 'https://via.placeholder.com/600x338.png/1e1e1e/ffffff?text=Test+Image+2',
                    source: 'Debug System', 
                    pubDate: new Date().toLocaleString()
                }
            ];
            this.starred = [{ guid: 'dummy2', starredAt: new Date().toISOString() }];
            this.shuffleCount = this.allEntries.length;
        },

        // --- UI Interaction Methods ---
        
        toggleHidden(guid) {
            const index = this.hidden.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.hidden.splice(index, 1);
            } else {
                this.hidden.push({ guid: guid, hiddenAt: new Date().toISOString() });
            }
        },

        isHidden(guid) {
            return this.hidden.some(item => item.guid === guid);
        },

        toggleStar(guid) {
            const index = this.starred.findIndex(item => item.guid === guid);
            if (index > -1) {
                this.starred.splice(index, 1);
            } else {
                this.starred.push({ guid: guid, starredAt: new Date().toISOString() });
            }
        },

        isStarred(guid) {
            return this.starred.some(item => item.guid === guid);
        },

        toggleTheme() {
            this.theme = this.theme === 'dark' ? 'light' : 'dark';
            this.applyTheme();
        },

        applyTheme() {
            // Use the script from index.html to apply the theme instantly on next load
            localStorage.setItem('theme', this.theme);
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(this.theme);
        },

        handleEntryLinks(element) {
            if (this.openUrlsInNewTabEnabled) {
                element.querySelectorAll('a').forEach(a => a.target = '_blank');
            }
        },
        
        processShuffle() { alert("Shuffle functionality placeholder."); },
        saveRssFeeds() { alert("Save functionality placeholder."); },
        saveKeywordBlacklist() { alert("Save functionality placeholder."); },
        scrollToTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    }));
});