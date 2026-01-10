import { AppState } from '@/types/app.ts';
import { initDb, closeDb } from '../data/dbCore.ts';
import { loadSimpleState, loadArrayState, saveSimpleState } from '../data/dbUserState.ts';
import { manageDailyDeck } from '../helpers/deckManager.ts';
import { performFeedSync } from '../data/dbSyncOperations.ts';
import { processPendingOperations } from '../data/dbSyncOperations.ts';
import { pullUserState } from '../data/dbSyncOperations.ts';
import { loadAndDisplayDeck, pregenerateDecks, loadDemoDeck } from '../controllers/deck.ts';
import { loadFeedItemsFromDB, computeFilteredEntries, loadRssFeeds, loadKeywordBlacklist } from '../controllers/feed.ts';
import { 
    initSyncToggle, 
    initImagesToggle, 
    initItemButtonMode, 
    initShadowsToggle, 
    initCurvesToggle, 
    initUrlsNewTabToggle, 
    initScrollPosition 
} from '../ui/uiInitializers.ts';
import { handleKeyboardShortcuts } from '../helpers/keyboardManager.ts';
import { 
    loadThemeStyle, loadCustomCss, loadFontSize, loadFeedWidth, 
    applyAnimationSpeed, applyThemeStyle, applyFonts, preloadThemes,
    applyCustomCss, applyFontSize, applyFeedWidth
} from '../ui/theme.ts';
import { _initImageObserver, _initScrollObserver, _initObservers } from '../ui/observers.ts';
import { isOnline } from '../utils/connectivity.ts';
import { loadAndPruneReadItems, loadCurrentDeck, loadShuffleState, loadFilterMode } from '../helpers/userStateUtils.ts';
import { auth } from '../firebase.ts'; // Correct path to firebase auth instance
import { createStatusBarMessage, updateCounts, attachScrollToTopHandler, manageSettingsPanelVisibility, saveCurrentScrollPosition } from '../ui/uiUpdaters.ts';
import { selectItem, handleEntryLinks } from '../controllers/interaction.ts';
import { parseRssFeedsConfig } from '../helpers/dataUtils.ts';

let initialAuthChecked = false;

export async function initApp(app: AppState): Promise<void> {
    try {
        // OPTIMISTIC AUTH: If we have a hint that we're logged in, proceed immediately
        const authHint = localStorage.getItem('isAuthenticated') === 'true';
        
        // Wait for auth initialization if no hint, but don't block forever
        // Note: authInitialized state tracking needs to be passed or handled.
        // For this refactor, we assume global auth state is managed by firebase listener outside.
        // We'll simulate the wait loop if needed, but ideally the listener sets state.
        
        if (!authHint) {
            console.log("[Auth] No hint found, waiting for verification...");
            app.progressMessage = 'Verifying authentication...';
            // In a real module, we might need a way to check if auth is ready.
            // For now, relying on the fact that onAuthStateChanged runs early.
            let waitCount = 0;
            // Hacky check for the global var or property - in module we might check auth.currentUser directly
            while (!auth.currentUser && waitCount < 20) { 
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
        } else {
            console.log("[Auth] Hint found, proceeding with optimistic load.");
        }

        // Redirect if we definitely aren't logged in (after hint check or verification)
        if (!authHint && !auth.currentUser && !window.location.pathname.endsWith('login.html')) {
            console.log("[Auth] Not logged in, entering Demo Mode.");
            app.isDemo = true;
            app.progressMessage = 'Loading demo...';
            
            // Initialize DB just for read-only/local (themes etc)
            try {
                app.db = await initDb();
                await _loadInitialState(app);
            } catch (e) {
                console.warn("[Demo] DB/State init failed, using defaults", e);
            }

            await loadDemoDeck(app);
            
            // Apply UI settings
            _initImageObserver(app);
            
            // Global listener to ensure all images (including those in x-html) get the fade-in class
            document.addEventListener('load', (e: Event) => {
                const target = e.target as HTMLElement;
                if (target.tagName === 'IMG') {
                    target.classList.add('loaded');
                }
            }, true);

            initSyncToggle(app);
            initImagesToggle(app);
            initItemButtonMode(app);
            initShadowsToggle(app);
            initCurvesToggle(app);
            initUrlsNewTabToggle(app);
            applyThemeStyle(app);
            applyFonts(app);
            
            app.loading = false;
            app._initComplete = true;
            
            // Start observers but SKIP sync tasks
            if ((app as any).$nextTick) {
                (app as any).$nextTick(() => {
                    _setupWatchers(app);
                    _setupEventListeners(app);
                    _initScrollObserver(app);
                    _initObservers(app);
                });
            }
            
            return;
        }

        if (auth.currentUser) {
            initialAuthChecked = true;
            app.userEmail = auth.currentUser.email || (auth.currentUser.isAnonymous ? 'Guest' : 'Authenticated User');
        }

        app.progressMessage = 'Connecting to database...';
        try {
            app.db = await initDb();
        } catch (dbError: any) {
            console.error("Database initialization failed:", dbError);
            throw new Error(`Local database failed: ${dbError.message}`);
        }
        
        app.progressMessage = 'Loading settings...';
        try {
            await _loadInitialState(app);
        } catch (stateError: any) {
            console.error("Initial state load failed:", stateError);
        }
        
        // DETECT NEW DEVICE / EMPTY STATE
        const isNewDevice = app.lastFeedSync === 0;
        if (isNewDevice && authHint) {
            console.log("[Init] New device detected (no local sync history). Performing full blocking sync.");
        }

        _initImageObserver(app);

        // Global listener to ensure all images (including those in x-html) get the fade-in class
        document.addEventListener('load', (e: Event) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
                target.classList.add('loaded');
            }
        }, true);

        // Warm up TTS voices
        if ('speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                const voices = window.speechSynthesis.getVoices();
                console.log(`[TTS] Voices loaded: ${voices.length} available.`);
            };
        }

        // Refresh online status
        app.isOnline = isOnline();

        // Background Sync Phase
        if (app.isOnline) {
            // Wait for actual auth before triggering network sync if we only had a hint
            // Logic adapted to module scope
            const syncLogic = async () => {
                if (auth.currentUser) {
                    console.log("[Init] Auth verified in background, triggering sync.");
                    if (isNewDevice) app.progressMessage = 'Restoring account data...';
                    
                    await processPendingOperations();
                    
                    // PHASE 1: Pull essential metadata only (deck, theme check)
                    // If new device, pull everything immediately
                    const skipKeys = isNewDevice ? [] : ['rssFeeds', 'keywordBlacklist', 'customCss', 'shuffleCount', 'lastShuffleResetDate', 'animationSpeed', 'openUrlsInNewTabEnabled', 'themeStyle', 'themeStyleLight', 'themeStyleDark', 'read', 'starred'];
                    await pullUserState(false, skipKeys, app); // Pass app context
                    
                    // PHASE 2: Trigger expensive content refresh
                    const SYNC_THRESHOLD_MS = 10 * 60 * 1000;
                    if ((Date.now() - (app.lastFeedSync || 0)) > SYNC_THRESHOLD_MS) {
                        if (isNewDevice) app.progressMessage = 'Downloading latest news...';
                        await performFeedSync(app);
                    }
                }
            };

            if (isNewDevice) {
                await syncLogic(); // Block if new device
            } else {
                syncLogic(); // Background if existing
            }
        }

        // Always load local data immediately
        app.progressMessage = 'Loading local data...';
        await _loadAndManageAllData(app);

        app.progressMessage = 'Applying user preferences...';
        initSyncToggle(app);
        initImagesToggle(app);
        initItemButtonMode(app);
        initShadowsToggle(app);
        initCurvesToggle(app);
        initUrlsNewTabToggle(app);
        attachScrollToTopHandler();
        
        if ((app as any).$nextTick) {
            (app as any).$nextTick(() => { initScrollPosition(app); });
        }
        
        if (app.deck.length === 0) {
            if (app.entries.length > 0) {
                app.progressMessage = 'Fetching and building your feed...';
            } else {
                app.progressMessage = 'No feed items found. Please configure your RSS feeds.';
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        } else {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (!app.selectedGuid) {
                const { value: lastId } = await loadSimpleState('lastViewedItemId');
                const isRestoring = lastId && app.deck.some(item => item.guid === lastId);
                if (!isRestoring && app.deck.length > 0) {
                    selectItem(app, app.deck[0].guid);
                }
            }
        }
        
        app.loading = false; // Hide main loading screen as soon as feed is ready
        app._initComplete = true;

        (async () => {
            console.log("[Init] Starting background initialization tasks...");
            _setupWatchers(app);
            _setupEventListeners(app);
            _startPeriodicSync(app);
            _startWorkerFeedSync(app);
            _initScrollObserver(app);
            _initObservers(app);
            pregenerateDecks(app);
            if (app.updateSyncStatusMessage) await app.updateSyncStatusMessage();
            
            if (auth.currentUser) {
                console.log("[Init] Pulling remaining user state in background...");
                await pullUserState(false, [], app);
            }
            console.log("[Init] Background initialization complete.");
        })();

    } catch (error: any) {
        console.error("Initialization failed:", error);
        app.errorMessage = `Could not load feed: ${error.message}`;
        app.progressMessage = `Error: ${error.message}`;
        app.loading = false;
        createStatusBarMessage(app, `Could not load feed: ${error.message}`);
    }
}

export async function _loadInitialState(app: AppState): Promise<void> {
    try {
        const [syncEnabled, imagesEnabled, itemButtonMode, urlsNewTab, filterModeResult, themeState, curvesState, animSpeedRes, lastFeedSyncRes, fontTitleRes, fontBodyRes] = await Promise.all([
            loadSimpleState('syncEnabled'),
            loadSimpleState('imagesEnabled'),
            loadSimpleState('itemButtonMode'),
            loadSimpleState('openUrlsInNewTabEnabled'),
            loadFilterMode(), 
            loadSimpleState('theme'),
            loadSimpleState('curvesEnabled'),
            loadSimpleState('animationSpeed'),
            loadSimpleState('lastFeedSync'),
            loadSimpleState('fontTitle'),
            loadSimpleState('fontBody')
        ]);
                        
        app.syncEnabled = syncEnabled.value ?? true;
        app.imagesEnabled = imagesEnabled.value ?? true;
        app.itemButtonMode = itemButtonMode.value ?? 'play';
        app.openUrlsInNewTabEnabled = urlsNewTab.value ?? true;
        app.curvesEnabled = curvesState.value ?? true;
        app.animationSpeed = animSpeedRes.value ?? 100;
        app.lastFeedSync = lastFeedSyncRes.value ?? 0;
        app.fontTitle = fontTitleRes.value ?? "'Playfair Display', serif";
        app.fontBody = fontBodyRes.value ?? "inherit";
        app.filterMode = filterModeResult;                
        const newTheme = (themeState.value === 'light' || themeState.value === 'dark') ? themeState.value : 'dark';
        if (app.theme !== newTheme) {
            app.theme = newTheme;
            localStorage.setItem('theme', app.theme);
        }
        
        app.isOnline = isOnline();
        
        const [rssFeeds, keywordBlacklist, themeStyleLightRes, themeStyleDarkRes] = await Promise.all([
            loadSimpleState('rssFeeds'),
            loadSimpleState('keywordBlacklist'),
            loadSimpleState('themeStyleLight'),
            loadSimpleState('themeStyleDark')
        ]);

        const newLightStyle = typeof themeStyleLightRes.value === 'string' ? themeStyleLightRes.value : 'originalLight';
        const newDarkStyle = typeof themeStyleDarkRes.value === 'string' ? themeStyleDarkRes.value : 'originalDark';
        
        app.themeStyleLight = newLightStyle === 'original' ? 'originalLight' : newLightStyle;
        app.themeStyleDark = newDarkStyle === 'original' ? 'originalDark' : newDarkStyle;
        
        localStorage.setItem('themeStyleLight', app.themeStyleLight);
        localStorage.setItem('themeStyleDark', app.themeStyleDark);

        const newStyle = app.theme === 'light' ? app.themeStyleLight : app.themeStyleDark;
        if (app.themeStyle !== newStyle) {
            app.themeStyle = newStyle;
            applyThemeStyle(app);
        }

        app.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');
        app.keywordBlacklistInput = Array.isArray(keywordBlacklist.value) 
            ? keywordBlacklist.value.join('\n') 
            : '';
        
        await loadCustomCss(app);
        await loadFontSize(app);
        await loadFeedWidth(app);
        applyAnimationSpeed(app);
        applyThemeStyle(app);
        applyFonts(app);

        app._initialRssFeedsInput = app.rssFeedsInput;
        app._initialKeywordBlacklistInput = app.keywordBlacklistInput;

        // Load pre-generated decks (local only)
        const [onlineDeckRes, offlineDeckRes] = await Promise.all([
            loadSimpleState('pregeneratedOnlineDeck'),
            loadSimpleState('pregeneratedOfflineDeck')
        ]);
        app.pregeneratedOnlineDeck = onlineDeckRes.value;
        app.pregeneratedOfflineDeck = offlineDeckRes.value;
    } catch (error: any) {
        console.error('Error loading initial state:', error);
        app.syncEnabled = true;
        app.imagesEnabled = true;
        app.openUrlsInNewTabEnabled = true;
        app.filterMode = 'unread';
        app.theme = 'dark';
        app.rssFeedsInput = '';
        app.keywordBlacklistInput = '';
    }
}

export async function _loadAndManageAllData(app: AppState, skipLoad: boolean = false): Promise<void> {
    console.log('_loadAndManageAllData: START');
    if (!skipLoad) {
        app.progressMessage = 'Loading saved feed items...';
        await loadFeedItemsFromDB(app);
    }
    console.log(`_loadAndManageAllData: After loadFeedItemsFromDB. Entries: ${app.entries.length}`);

    app.progressMessage = 'Loading user state from storage...';
    
    const [starredRes, shuffledRes, currentDeckRes, shuffleState, rssFeedsRes, blacklistRes] = await Promise.all([
        loadArrayState('starred'),
        loadArrayState('shuffledOutGuids'),
        loadCurrentDeck(),
        loadShuffleState(),
        loadSimpleState('rssFeeds'),
        loadSimpleState('keywordBlacklist')
    ]);

    console.log('_loadAndManageAllData: Loaded starred state:', starredRes.value);
    app.starred = Array.isArray(starredRes.value) ? starredRes.value : [];
    app.shuffledOutGuids = Array.isArray(shuffledRes.value) ? shuffledRes.value : [];
    app.currentDeckGuids = Array.isArray(currentDeckRes) ? currentDeckRes : [];
    console.log('_loadAndManageAllData: Loaded currentDeckGuids:', app.currentDeckGuids.slice(0, 3), typeof app.currentDeckGuids[0]);

    app.shuffleCount = shuffleState.shuffleCount;
    app.lastShuffleResetDate = shuffleState.lastShuffleResetDate;
    
    app.rssFeedsInput = parseRssFeedsConfig(rssFeedsRes.value).join('\n');
    app.keywordBlacklistInput = Array.isArray(blacklistRes.value) ? blacklistRes.value.join('\n') : '';
    app._initialRssFeedsInput = app.rssFeedsInput;
    app._initialKeywordBlacklistInput = app.keywordBlacklistInput;

    app.progressMessage = 'Optimizing local storage...';
    app.read = await loadAndPruneReadItems(Object.values(app.feedItems));
    console.log(`_loadAndManageAllData: After loadAndPruneReadItems. Read count: ${app.read.length}`);

    console.log("_loadAndManageAllData: Before manageDailyDeck", { readCount: app.read.length, currentDeckGuidsCount: app.currentDeckGuids.length, shuffleCount: app.shuffleCount });

    const isOnline = app.isOnline;
    const pregenKey = isOnline ? 'pregeneratedOnlineDeck' : 'pregeneratedOfflineDeck';
    const pregenDeck = app[pregenKey as keyof AppState] as any;
    
    const result = await manageDailyDeck(
        Array.from(app.entries),
        app.read,
        app.starred,
        app.shuffledOutGuids,
        app.shuffleCount,
        app.filterMode,
        app.lastShuffleResetDate,
        pregenDeck,
        app
    );

    app.deck = result.deck;
    app.currentDeckGuids = result.currentDeckGuids;
    app.shuffledOutGuids = result.shuffledOutGuids;
    app.shuffleCount = result.shuffleCount;
    app.lastShuffleResetDate = result.lastShuffleResetDate;

    if (pregenDeck && pregenDeck.length > 0 && app.currentDeckGuids.length > 0 && 
        app.currentDeckGuids[0].guid === pregenDeck[0].guid) {
        console.log(`[deckManager] Consumed pre-generated ${isOnline ? 'ONLINE' : 'OFFLINE'} deck in _loadAndManageAllData.`);
        if (pregenKey === 'pregeneratedOnlineDeck') {
            app.pregeneratedOnlineDeck = null;
        } else {
            app.pregeneratedOfflineDeck = null;
        }
            
        await saveSimpleState(pregenKey, null, 'userSettings', app);
        pregenerateDecks(app); 
    }

    console.log("_loadAndManageAllData: After manageDailyDeck. Deck size:", app.deck.length);

    app.progressMessage = "Displaying your feed...";
    await loadAndDisplayDeck(app);
    console.log("_loadAndManageAllData: After loadAndDisplayDeck. Final Deck size:", app.deck.length);

    if (app.updateAllUI) app.updateAllUI();

    if (app._initComplete && app.deck.length > 0 && !app.showUndo) {
        console.log("[_loadAndManageAllData] Auto-selecting first item after refresh.");
        selectItem(app, app.deck[0].guid);
    }

    console.log("_loadAndManageAllData: END");
}

export function _setupWatchers(app: AppState): void {
    if (!(app as any).$watch) return;
    
    (app as any).$watch("openShortcuts", async (isOpen: boolean) => {
        const isMobile = window.innerWidth < 1024;
        if (isOpen) {
            if (!isMobile) document.body.classList.add('no-scroll');
            await saveCurrentScrollPosition();
        } else {
            document.body.classList.remove('no-scroll');
            document.body.style.overflow = '';
        }
    });
    (app as any).$watch('openSettings', async (open: boolean) => {
        const isMobile = window.innerWidth < 1024;
        if (open) {
            if (window.location.hash !== '#settings') {
                window.history.pushState({ modal: 'settings' }, '', '#settings');
            }

            app.showUndo = false;
            app.backupSelections = {
                feeds: true,
                appearance: true,
                history: true,
                settings: true
            };
            app.showRestorePreview = false;
            app.restoreData = null;

            if (!isMobile) document.body.classList.add('no-scroll');
            app.modalView = 'main';
            await manageSettingsPanelVisibility(app);
            
            if ((app as any).$nextTick) {
                (app as any).$nextTick(() => {
                    const modal = document.querySelector('.modal-content');
                    const firstFocusable = modal?.querySelector('button, select, input, textarea') as HTMLElement;
                    firstFocusable?.focus();
                });
            }

            const [rssFeeds, storedKeywords] = await Promise.all([
                loadSimpleState('rssFeeds'),
                loadSimpleState('keywordBlacklist')
            ]);
            app.rssFeedsInput = parseRssFeedsConfig(rssFeeds.value).join('\n');
            if (Array.isArray(storedKeywords.value)) {
                app.keywordBlacklistInput = storedKeywords.value.filter(Boolean).sort().join("\n");
            } else if (typeof storedKeywords.value === 'string') {
                app.keywordBlacklistInput = storedKeywords.value.split(/\r?\n/).filter(Boolean).sort().join("\n");
            } else {
                app.keywordBlacklistInput = '';
            }
            
            app._initialRssFeedsInput = app.rssFeedsInput;
            app._initialKeywordBlacklistInput = app.keywordBlacklistInput;
            
            await saveCurrentScrollPosition();
        } else {
            if (window.location.hash === '#settings') {
                window.history.back();
            }
            document.body.classList.remove('no-scroll');
            document.body.style.overflow = '';
            await saveCurrentScrollPosition();
        }
    });

    (app as any).$watch('fullscreenImage', (src: string | null) => {
        if (src) {
            if (window.location.hash !== '#image') {
                window.history.pushState({ modal: 'image' }, '', '#image');
            }
        } else {
            if (window.location.hash === '#image') {
                window.history.back();
            }
        }
    });

    window.addEventListener('popstate', (e) => {
        if (app.openSettings && window.location.hash !== '#settings') {
            app.openSettings = false;
        }
        if (app.openShortcuts && window.location.hash !== '#shortcuts') {
            app.openShortcuts = false;
        }
        if (app.fullscreenImage && window.location.hash !== '#image') {
            app.fullscreenImage = null;
        }
    });

    (app as any).$watch('openUrlsInNewTabEnabled', () => {
        document.querySelectorAll('.itemdescription').forEach((el: Element) => handleEntryLinks(app, el));
    });

    (app as any).$watch('modalView', async () => {
        await manageSettingsPanelVisibility(app);
        if ((app as any).$nextTick) {
            (app as any).$nextTick(() => {
                const modal = document.querySelector('.modal-content');
                const focusable = modal?.querySelector('div[style*="display: block"] button, div[style*="display: block"] select, div[style*="display: block"] input, div[style*="display: block"] textarea') as HTMLElement;
                focusable?.focus();
            });
        }
    });

    (app as any).$watch('filterMode', async (newMode: string) => {
        const { setFilterMode } = await import('../helpers/userStateUtils.ts');
        await setFilterMode(app, newMode);
        
        if (newMode === 'unread') {
            const result = await manageDailyDeck(
                Array.from(app.entries), app.read, app.starred, app.shuffledOutGuids,
                app.shuffleCount, app.filterMode, app.lastShuffleResetDate,
                null,
                app
            );
            app.deck = result.deck;
            app.currentDeckGuids = result.currentDeckGuids;
            app.shuffleCount = result.shuffleCount;
            app.lastShuffleResetDate = result.lastShuffleResetDate;
        }
        scrollToTop();
    });

    (app as any).$watch('shadowsEnabled', (enabled: boolean) => {
        document.body.classList.toggle('no-shadows', !enabled);
    });
    document.body.classList.toggle('no-shadows', !app.shadowsEnabled);

    (app as any).$watch('curvesEnabled', (enabled: boolean) => {
        document.body.classList.toggle('no-curves', !enabled);
        if (enabled) {
            app.undoBtnRadius = 20;
        } else {
            app.undoBtnRadius = 0;
        }
    });
    document.body.classList.toggle('no-curves', !app.curvesEnabled);
    if (!app.curvesEnabled) app.undoBtnRadius = 0;

    (app as any).$watch('entries', () => updateCounts(app));
    (app as any).$watch('read', () => updateCounts(app));
    (app as any).$watch('starred', () => updateCounts(app));
    (app as any).$watch('currentDeckGuids', () => updateCounts(app));
    
    (app as any).$watch('selectedGuid', (newGuid: string | null) => {
        if (newGuid) {
            app.lastSelectedGuid = newGuid;
            app.selectedTimestamp = Date.now();
            app.selectedSubElement = 'item';
        } else {
            app.selectedTimestamp = null;
            app.selectedSubElement = 'item';
        }
    });

    (app as any).$watch('isOnline', (online: boolean) => {
        document.documentElement.style.setProperty('--offline-padding', online ? '0' : '30px');
    });
    
    (app as any).$watch('fontTitle', () => applyFonts(app));
    (app as any).$watch('fontBody', () => applyFonts(app));

    document.documentElement.style.setProperty('--offline-padding', app.isOnline ? '0' : '30px');
}

export function _setupEventListeners(app: AppState): void {
    const backgroundSync = async () => {
        if (!app.syncEnabled || !app.isOnline) return;
        console.log('Performing periodic background sync...');
        try {
            await processPendingOperations();
            const syncSuccess = await performFeedSync(app);
            await pullUserState();
            await _loadAndManageAllData(app);
            app.deckManaged = true;
            console.log(`Background sync complete. Success: ${syncSuccess}`);
        } catch (e) {
            console.error("Error in background sync setup listener:", e);
        }
    };

    window.addEventListener('online', async () => {
        app.isOnline = true;
        if (app.updateSyncStatusMessage) await app.updateSyncStatusMessage();
        
        if (app.syncEnabled) {
            try {
                await processPendingOperations();
                await backgroundSync();
            } catch (e) {
                console.error("Error handling online event:", e);
            }
        }
    });

    window.addEventListener('offline', async () => {
        app.isOnline = false;
        if (app.updateSyncStatusMessage) await app.updateSyncStatusMessage();
    });

    let scrollTimeout: any;
    window.addEventListener('scroll', () => {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            saveCurrentScrollPosition();
        }, 1000);
    }, { passive: true });

    window.addEventListener('keydown', (e) => {
        handleKeyboardShortcuts(e, app);
    });

    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // Re-check connectivity
            const online = isOnline();
            if (app.isOnline !== online) {
                console.log(`[Connectivity] Visibility change detected. Updating status: ${online ? 'ONLINE' : 'OFFLINE'}`);
                app.isOnline = online;
                if (app.updateSyncStatusMessage) app.updateSyncStatusMessage();
            }
            
            // Fix sticky selection animation issues by forcing a re-render of selection if needed
            if (app.selectedGuid) {
                console.log("[Visibility] App returned to foreground. Redrawing selection animation.");
                const current = app.selectedGuid;
                app.selectedGuid = null;
                if ((app as any).$nextTick) {
                    (app as any).$nextTick(() => { app.selectedGuid = current; });
                }
            }
        }
    });

    // Connectivity heartbeat
    setInterval(() => {
        const online = isOnline();
        if (app.isOnline !== online) {
            console.log(`[Connectivity] Heartbeat status change: ${online ? 'ONLINE' : 'OFFLINE'}`);
            app.isOnline = online;
            if (app.updateSyncStatusMessage) app.updateSyncStatusMessage();
        }
    }, 30000);
}

export function _startPeriodicSync(app: AppState): void {
    let lastActivityTimestamp = Date.now();
    const recordActivity = () => lastActivityTimestamp = Date.now();
    
    ["mousemove", "mousedown", "keydown", "scroll", "click", "visibilitychange", "focus"].forEach((event: string) => {
        document.addEventListener(event, recordActivity, true);
        if (event === 'focus') window.addEventListener(event, recordActivity, true);
        if (event === 'visibilitychange') document.addEventListener(event, recordActivity, true);
    });

    const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const INACTIVITY_TIMEOUT_MS = 60 * 1000; // 1 minute

    setInterval(async () => {
        const now = Date.now();
        // Only sync if online, settings closed, sync enabled, and user is active
        if (!app.isOnline || app.openSettings || !app.syncEnabled || (now - lastActivityTimestamp) > INACTIVITY_TIMEOUT_MS) {
            return;
        }
        
        console.log('Starting scheduled background sync...');
        try {
            await processPendingOperations();
            const syncSuccess = await performFeedSync(app);
            await pullUserState(); // Pull any other changes
            await _loadAndManageAllData(app);
            app.deckManaged = true;
            console.log(`Scheduled sync complete. Success: ${syncSuccess}`);
            if (!syncSuccess) {
                createStatusBarMessage(app, 'Sync finished with issues.');
            }
            
            // Pre-generate next deck for smoother transitions later
            await pregenerateDecks(app);
        } catch (error: any) {
            console.error('Periodic sync failed:', error);
            createStatusBarMessage(app, 'Sync failed!');
        }
    }, SYNC_INTERVAL_MS);
}

export function _startWorkerFeedSync(app: AppState): void {
    // This is a secondary, less frequent check that hits the worker directly
    // to ensure the worker cache is warm and perhaps get updates if main sync missed something.
    setInterval(async () => {
        if (!app.isOnline || !app.syncEnabled) return;
        
        console.log('[Worker Sync] Triggering background feed processing...');
        try {
            const token = await import('../data/dbAuth.ts').then(m => m.getAuthToken());
            if (!token) return;
            
            // Fire and forget
            fetch(`${import.meta.env.VITE_API_BASE_URL || window.location.origin}/api/refresh`, { 
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            })
            .then(r => r.json())
            .then(data => console.log('[Worker Sync] Background sync complete:', data))
            .catch(e => console.error('[Worker Sync] Background sync failed:', e));
        } catch (e) {
            console.error('[Worker Sync] Periodic setup failed:', e);
        }
    }, 600 * 1000); // 10 minutes
}
