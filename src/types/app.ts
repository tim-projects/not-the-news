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
    modalView: string;
    shuffleCount: number;
    lastShuffleResetDate: string | null;
    syncEnabled: boolean;
    imagesEnabled: boolean;
    openUrlsInNewTabEnabled: boolean;
    rssFeedsInput: string;
    keywordBlacklistInput: string;
    shadowsEnabled: boolean;
    entries: MappedFeedItem[];
    read: ReadItem[];
    starred: StarredItem[];
    currentDeckGuids: DeckItem[];
    shuffledOutGuids: ShuffledOutItem[];
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
    showUndo: boolean;
    undoTimerActive: boolean;
    undoItemGuid: string | null;
    undoItemIndex: number | null;
    db: any | null;
    _lastFilterHash: string;
    _cachedFilteredEntries: MappedFeedItem[] | null;
    scrollObserver: IntersectionObserver | null;
    imageObserver: IntersectionObserver | null;
    staleItemObserver: IntersectionObserver | null;
    _initComplete: boolean;
    _isSyncing: boolean;

    // --- Core Methods ---
    initApp(): Promise<void>;
    updateCounts(): Promise<void>;
    performBackgroundSync(): Promise<void>;
    _reconcileAndRefreshUI(): Promise<void>;
    _initObservers(): void;
    updateSyncStatusMessage(): Promise<void>;
    loadAndDisplayDeck(): Promise<void>;
    loadFeedItemsFromDB(): Promise<void>;
    readonly filteredEntries: MappedFeedItem[];
    isStarred(guid: string): boolean;
    isRead(guid: string): boolean;
    toggleStar(guid: string): Promise<void>;
    toggleRead(guid: string): Promise<void>;
    undoMarkRead(): Promise<void>;
    processShuffle(): Promise<void>;
    loadRssFeeds(): Promise<void>;
    loadKeywordBlacklist(): Promise<void>;
    loadCustomCss(): Promise<void>;
    loadThemeStyle(): Promise<void>;
    loadFontSize(): Promise<void>;
    saveRssFeeds(): Promise<void>;
    saveKeywordBlacklist(): Promise<void>;
    saveCustomCss(): Promise<void>;
    saveThemeStyle(): Promise<void>;
    saveFontSize(): Promise<void>;
    resetCustomCss(): Promise<void>;
    generateCustomCssTemplate(): string;
    applyCustomCss(): void;
    applyThemeStyle(): void;
    applyFontSize(): void;
    toggleTheme(): Promise<void>;
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

    // Alpine.js specific properties (need to be declared if used in 'this' context)
    $nextTick: (callback: (this: AppState) => void) => Promise<void>;
    $watch: (property: string, callback: (newValue: any, oldValue: any) => void) => void;
}