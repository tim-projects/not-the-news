if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(reg => {
    console.log('SW registered:', reg.scope);
    reg.addEventListener('updatefound', () => {
      const newSW = reg.installing;
      newSW.addEventListener('statechange', () => {
        if (newSW.state === 'activated') { window.location.reload(); }
      });
    });
  }).catch(err => console.warn('SW registration failed:', err));
}

import {
  dbPromise, bufferedChanges, pushUserState, performSync, performFullSync, pullUserState, processPendingOperations,
  isStarred, toggleStar, isHidden, toggleHidden, loadHidden, loadStarred, pruneStaleHidden
} from "./js/database.js";
import {
  scrollToTop, attachScrollToTopHandler, formatDate,
  setFilter, updateCounts, loadFilterMode,
  shuffleFeed as handleShuffleFeed, mapRawItems
} from "./js/functions.js";
import { initSync, initTheme, initImages, initScrollPos, initConfigComponent, loadSyncEnabled, loadImagesEnabled } from "./js/settings.js";

window.rssApp = () => ({
  openSettings: false,
  entries: [],
  isOnline: navigator.onLine,
  hidden: [],
  starred: [],
  filterMode: "unread",
  imagesEnabled: null,
  syncEnabled: null,
  isShuffled: false,
  shuffleCount: 10,
  currentSettingsPanel: 'main',
  autoSyncFeed: false,
  theme: 'light',
  isDarkTheme: false,
  rssFeedsInput: '',
  rssSaveMessage: '',
  keywordBlacklistInput: '',
  keywordsSaveMessage: '',
  loading: true,

  scrollToTop,
  _attachScrollToTopHandler: attachScrollToTopHandler,
  formatDate,
  updateCounts,
  isStarred(link) { return isStarred(this, link); },
  toggleStar(link) { toggleStar(this, link); },
  setFilter(mode) { setFilter(this, mode); },
  shuffleFeed() { handleShuffleFeed(this); },

  async init() {
    this.loading = true;
    let serverTime = 0;
    try {
      this.syncEnabled = await loadSyncEnabled();
      this.imagesEnabled = await loadImagesEnabled();
      
      initTheme();
      initSync(this);
      initImages(this);
      this.hidden = await loadHidden();
      this.starred = await loadStarred();

      const db = await dbPromise;
      const count = await db.transaction('items', 'readonly').objectStore('items').count();
      if (count === 0 && this.isOnline) {
        const { feedTime } = await performFullSync();
        serverTime = feedTime;
        this.hidden = await loadHidden();
        this.starred = await loadStarred();
      } else {
        serverTime = Date.now();
      }
      initConfigComponent(this);
      window.addEventListener('online', () => {
        this.isOnline = true;
        if (this.syncEnabled && typeof this.syncPendingChanges === 'function') {
          this.syncPendingChanges();
        }
      });
      window.addEventListener('offline', () => { this.isOnline = false; });
      const rawList = await db.transaction('items', 'readonly').objectStore('items').getAll();
      this.entries = mapRawItems(rawList, this.formatDate);
      this.hidden = await pruneStaleHidden(this.entries, serverTime);
      this.updateCounts();
      initScrollPos(this);
      this.loading = false;
      if (this.syncEnabled) {
        setTimeout(async () => {
          try {
            await performSync();
            await pullUserState(await dbPromise);
            this.hidden = await loadHidden();
            this.starred = await loadStarred();
            const freshRaw = await db.transaction('items', 'readonly').objectStore('items').getAll();
            this.entries = mapRawItems(freshRaw, this.formatDate);
            this.hidden = await pruneStaleHidden(this.entries, Date.now());
            this.updateCounts();
          } catch (err) {
            console.error('Background partial sync failed', err);
          }
        }, 0);
      }
      this._attachScrollToTopHandler();
      let lastActivity = Date.now();
      const resetActivity = () => { lastActivity = Date.now(); };
      ["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(evt => document.addEventListener(evt, resetActivity, true));
      document.addEventListener("visibilitychange", resetActivity, true);
      window.addEventListener("focus", resetActivity, true);

      const SYNC_INTERVAL = 5 * 60 * 1000;
      const IDLE_THRESHOLD = 60 * 1000;

      setInterval(async () => {
        const now = Date.now();
        if (this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivity) > IDLE_THRESHOLD) { return; }
        try {
          await performSync();
          await pullUserState(await dbPromise);
          this.hidden = await pruneStaleHidden(this.entries, now);
        } catch (err) {
          console.error("Partial sync failed", err);
        }
      }, SYNC_INTERVAL);
    } catch (err) {
      console.error("loadFeed failed", err);
      this.errorMessage = "Could not load feed: " + err.message;
    } finally {
      this.loading = false;
    }
  },
  async syncPendingChanges() {
    if (!this.isOnline) return;
    try { await processPendingOperations(); } catch (err) { console.error('syncPendingChanges failed', err); }
  },
  isHidden(link) { return isHidden(this, link); },
  toggleHidden(link) { return toggleHidden(this, link); },

  _lastFilterHash: "",
  _cachedFilteredEntries: null,

  get filteredEntries() {
    const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}`;

    if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
      return this._cachedFilteredEntries;
    }

    const hiddenSet = new Set(this.hidden.map(h => h.id));
    const starredSet = new Set(this.starred.map(s => s.id));

    this._cachedFilteredEntries = this.entries.filter(entry => {
      switch (this.filterMode) {
        case "all": return true;
        case "unread": return !hiddenSet.has(entry.id);
        case "hidden": return hiddenSet.has(entry.id);
        case "starred": return starredSet.has(entry.id);
        default: return true;
      }
    });

    this._lastFilterHash = currentHash;
    return this._cachedFilteredEntries;
  }
});
document.addEventListener("load", e => {
  if (e.target.tagName.toLowerCase() === "img") {
    e.target.classList.add("loaded");
  }
}, true);