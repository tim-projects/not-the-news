export const appState = () => ({
    openSettings: false,
    entries: [],
    isOnline: navigator.onLine,
    hidden: [],
    starred: [],
    filterMode: "unread",
    imagesEnabled: null,
    syncEnabled: null,
    isShuffled: false,
    shuffleCount: 2,
    modalView: 'main', // Controls which settings panel is visible
    rssFeedsInput: '',
    keywordBlacklistInput: '',
    loading: true,
    currentDeckGuids: [],
    errorMessage: '',
    // --- ADD THIS NEW PROPERTY ---
    deckItems: [], // This will hold the actual item objects to be displayed in the current deck

    // Placeholders for functions that will be mixed in or called from main app logic
    initApp: null, // Will be assigned the main init function
    toggleStar: null,
    toggleHidden: null,
    setFilter: null,
    updateCounts: null,
    scrollToTop: null,
    loadNextDeck: null,
    shuffleFeed: null,

    _lastFilterHash: "",
    _cachedFilteredEntries: null,

    get filteredEntries() {
        // Create a hash to memoize based on relevant properties
        // Updated hash to include keywordBlacklistInput for more accurate memoization if it affects filteredEntries
        const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}-${this.keywordBlacklistInput}`;

        if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
            return this._cachedFilteredEntries;
        }

        const hiddenMap = new Map(this.hidden.map(h => [h.id, h.hiddenAt]));
        const starredMap = new Map(this.starred.map(s => [s.id, s.starredAt]));
        let filtered = [];

        switch (this.filterMode) {
            case "all":
                filtered = this.entries;
                break;
            case "unread":
                const deckSet = new Set(this.currentDeckGuids);
                filtered = this.entries.filter(e => deckSet.has(e.id) && !hiddenMap.has(e.id));
                break;
            case "hidden":
                filtered = this.entries.filter(e => hiddenMap.has(e.id)).sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
                break;
            case "starred":
                filtered = this.entries.filter(e => starredMap.has(e.id)).sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
                break;
            default:
                filtered = this.entries;
                break;
        }
        
        // Apply keyword blacklist if it exists
        const keywordBlacklist = this.keywordBlacklistInput.split(',').map(kw => kw.trim().toLowerCase()).filter(kw => kw.length > 0);
        if (keywordBlacklist.length > 0) {
            filtered = filtered.filter(item => {
                const title = item.title ? item.title.toLowerCase() : '';
                const description = item.description ? item.description.toLowerCase() : '';
                return !keywordBlacklist.some(keyword => title.includes(keyword) || description.includes(keyword));
            });
        }

        this._cachedFilteredEntries = filtered;
        this._lastFilterHash = currentHash;
        return this._cachedFilteredEntries;
    }
});