export interface RssFeedCategory {
    [subcategory: string]: { url: string }[];
}

export interface RssFeedsConfig {
    [category: string]: RssFeedCategory;
}

export interface MappedFeedItem {
    guid: string;
    title: string;
    link: string;
    pubDate: string;
    description: string;
    content?: string;
    author?: string;
    isoDate?: string;
    source: string;
    image: string;
    isRead?: boolean; // Added for TypeScript migration
    isStarred?: boolean; // Added for TypeScript migration
    isStale?: boolean; // Used in filteredEntries getter in main.ts
    timestamp: number; // Added for sorting purposes
    // Add other properties that MappedFeedItem might have
}

export interface ReadItem {
    guid: string;
    readAt: string; // ISO 8601 date string
}

export interface StarredItem {
    guid: string;
    starredAt: string; // ISO 8601 date string
}

export interface DeckItem {
    guid: string;
    addedAt: string; // ISO 8601 date string
}

export interface ShuffledOutItem {
    guid: string;
    shuffledAt: string; // ISO 8601 date string
}

export interface PendingOperation {
    type: string; // e.g., 'readDelta', 'starredDelta', 'simpleUpdate', 'arrayUpdate'
    guid?: string; // For delta operations
    action?: 'add' | 'remove'; // For delta operations
    timestamp: string;
    key?: string; // For simpleUpdate/arrayUpdate
    value?: any; // For simpleUpdate/arrayUpdate
    items?: any[]; // For arrayUpdate
}

export interface AppState {
    // --- State Properties ---
    loading: boolean;
    progressMessage: string;
    deck: MappedFeedItem[];
    feedItems: { [guid: string]: any }; // Adjust 'any' to a more specific type if known
    filterMode: string;
    openSettings: boolean;
    openShortcuts: boolean;
    modalView: string;
    showSearchBar: boolean;
    searchQuery: string;
    shuffleCount: number;
    lastShuffleResetDate: string | null;
    syncEnabled: boolean;
    imagesEnabled: boolean;
    itemButtonMode: 'hide' | 'play';
    openUrlsInNewTabEnabled: boolean;
    rssFeedsInput: string;
    keywordBlacklistInput: string;
    discoveryUrl: string;
    isDiscovering: boolean;
    discoveryResults: string[];
    discoveryError: string;
    shadowsEnabled: boolean;
    curvesEnabled: boolean;
    entries: MappedFeedItem[];
    read: ReadItem[];
    starred: StarredItem[];
    currentDeckGuids: DeckItem[];
    shuffledOutGuids: ShuffledOutItem[];
    pregeneratedOnlineDeck: DeckItem[] | null;
    pregeneratedOfflineDeck: DeckItem[] | null;
    settingsButtonClicks?: number;
    errorMessage: string;
    isOnline: boolean;
    deckManaged: boolean;
    syncStatusMessage: string;
    showSyncStatus: boolean;
    theme: string;
    themeStyle: string;
    themeStyleLight: string;
    themeStyleDark: string;
    customCss: string;
    fontSize: number;
    feedWidth: number;
    showUndo: boolean;
    undoTimerActive: boolean;
    undoItemGuid: string | null;
    undoItemIndex: number | null;
    undoBtnRadius: number;
    selectedGuid: string | null;
    selectedSubElement: 'item' | 'read' | 'star' | 'play';
    selectedTimestamp: number | null;
    lastSelectedGuid: string | null;
    starredGuid: string | null;
    readingGuid: string | null;
    speakingGuid: string | null; // Track which item is being read out
    closingGuid: string | null; // Track item animating out
    db: any | null;
    _lastFilterHash: string;
    _cachedFilteredEntries: MappedFeedItem[] | null;
    scrollObserver: IntersectionObserver | null;
    imageObserver: IntersectionObserver | null;
    staleItemObserver: IntersectionObserver | null;
    _initComplete: boolean;
    _isSyncing: boolean;
    _isPregenerating: boolean; // Concurrency lock for background generation

    // --- Core Methods ---
    initApp(): Promise<void>;
    updateCounts(): void;
    performBackgroundSync(): Promise<void>;
    _reconcileAndRefreshUI(): Promise<void>;
    _initObservers(): void;
    updateSyncStatusMessage(): Promise<void>;
    loadAndDisplayDeck(): Promise<void>;
    loadFeedItemsFromDB(): Promise<void>;
    readonly filteredEntries: MappedFeedItem[];
    readonly allCount: number;
    readonly starredCount: number;
    readonly readCount: number;
    readonly unreadCount: number;
    isStarred(guid: string): boolean;
    isRead(guid: string): boolean;
    toggleStar(guid: string): Promise<void>;
    toggleRead(guid: string): Promise<void>;
    speakItem(guid: string): void; // New method for TTS
    undoMarkRead(): Promise<void>;
    selectItem(guid: string): void;
    processShuffle(): Promise<void>;
    loadFontSize(): Promise<void>;
    loadFeedWidth(): Promise<void>;
    loadThemeStyle(): Promise<void>;
    loadRssFeeds(): Promise<void>;
    loadKeywordBlacklist(): Promise<void>;
    saveRssFeeds(): Promise<void>;
    saveKeywordBlacklist(): Promise<void>;
    saveCustomCss(): Promise<void>;
    saveThemeStyle(): Promise<void>;
    saveFontSize(): Promise<void>;
    saveFeedWidth(): Promise<void>;
    resetCustomCss(): Promise<void>;
    generateCustomCssTemplate(): string;
    applyCustomCss(): void;
    applyThemeStyle(): void;
    applyFontSize(): void;
    applyFeedWidth(): void;
    updateThemeAndStyle(newStyle: string, newTheme: 'light' | 'dark'): Promise<void>;
    scrollToTop(): void;
    observeImage(el: HTMLImageElement): void;
    _initImageObserver(): void;
    resetApplicationData(): Promise<void>;
    backupConfig(): Promise<void>;
    restoreConfig(event: Event): Promise<void>;
    _loadInitialState(): Promise<void>;
    _loadAndManageAllData(initialEntries?: MappedFeedItem[]): Promise<void>;
    updateAllUI(): void;
    _setupWatchers(): void;
    _setupEventListeners(): void;
    _startPeriodicSync(): void;
    _initScrollObserver(): void;
    handleEntryLinks(element: Element): void;
    pregenerateDecks(): Promise<void>;
    _generateAndSavePregeneratedDeck(online: boolean): Promise<void>;
    loadCustomCss(): Promise<void>;
    toggleSearch(): void;
    discoverFeed(): Promise<void>;

    // Alpine.js specific properties (need to be declared if used in 'this' context)
    $nextTick: (callback: (this: AppState) => void) => Promise<void>;
    $watch: (property: string, callback: (newValue: any, oldValue: any) => void) => void;
}