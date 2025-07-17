if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
    .then(reg => {
      console.log('SW registered:', reg.scope);
      // when a new SW is found, reload once it's activated
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW.addEventListener('statechange', () => {
          if (newSW.state === 'activated') {
            window.location.reload();
          }
        });
      });
    })
    .catch(err => console.warn('SW registration failed:', err));
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

window.rssApp = () => {
  return {
    openSettings: false, // Controls visibility of the settings modal
    entries: [],
    isOnline: navigator.onLine, // start with current network status
    hidden: [],
    starred: [],
    filterMode: "unread",
    imagesEnabled: null,
    syncEnabled: null,
    isShuffled: false,              // Track whether we're in shuffled mode
    shuffleCount: 10,               // How many shuffles remain

    loading: true,

    // map-in our external helpers
    scrollToTop,
    _attachScrollToTopHandler: attachScrollToTopHandler,
    formatDate,
    updateCounts,
    isStarred(link) { return isStarred(this, link); },
    toggleStar(link) { toggleStar(this, link); },
    setFilter(mode) { setFilter(this, mode); },
    shuffleFeed() { handleShuffleFeed(this); },

    async init() {
      this.loading = true; //loading screen
      let serverTime = 0;
      try {
        this.syncEnabled = await loadSyncEnabled();
        this.imagesEnabled = await loadImagesEnabled();
        initTheme();
        initSync(this);
        initImages(this);
        initConfigComponent(this);
        // Load user‑state from IndexedDB
        this.hidden = await loadHidden();
        this.starred = await loadStarred();

        // 0) Full Sync on empty DB—but only if online
        const db = await dbPromise;
        const count = await db.transaction('items', 'readonly').objectStore('items').count();
        if (count === 0 && this.isOnline) {
          // first run *and* online: full feed+user‑state pull from server
          const { feedTime } = await performFullSync();
          serverTime = feedTime;
          this.hidden = await loadHidden();
          this.starred = await loadStarred();
        } else {
          // offline or not first run → use local data
          serverTime = Date.now();
        }
        // ─── network detection & offline queue sync ─────────────────
        window.addEventListener('online', () => {
          this.isOnline = true;
          if (this.syncEnabled && typeof this.syncPendingChanges === 'function') {
            this.syncPendingChanges();
          }
        });
        window.addEventListener('offline', () => {
          this.isOnline = false;
        });
        // 1) Load items from indexedDB and map/sort via helper
        const rawList = await db.transaction('items', 'readonly').objectStore('items').getAll();
        this.entries = mapRawItems(rawList, this.formatDate);
        this.hidden = await pruneStaleHidden(this.entries, serverTime);
        this.updateCounts(); // update dropdown
        initScrollPos(this); // restore previous scroll position once entries are rendered
        this.loading = false;
        // 2) kick off one‑off background partial sync
        if (this.syncEnabled) {
          setTimeout(async () => {
            try {
              await performSync();
              await pullUserState(await dbPromise);
              this.hidden = await loadHidden();
              this.starred = await loadStarred();
              // re‑load & re‑render using helper
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
        // ─── user activity / idle detection ───────────────────────────
        let lastActivity = Date.now();
        const resetActivity = () => { lastActivity = Date.now(); };
        // listen for any “activity” events
        ["mousemove", "mousedown", "keydown", "scroll", "click"]
          .forEach(evt => document.addEventListener(evt, resetActivity, true));
        document.addEventListener("visibilitychange", resetActivity, true);
        window.addEventListener("focus", resetActivity, true);

        const SYNC_INTERVAL = 5 * 60 * 1000;  // 5 min default sync cycle
        const IDLE_THRESHOLD = 60 * 1000;      // 1 min of no activity → skip sync

        setInterval(async () => {
          const now = Date.now();
          if ( // if settings open, sync off, page hidden, or idle → bail
            this.openSettings ||
            !this.syncEnabled ||
            document.hidden ||
            (now - lastActivity) > IDLE_THRESHOLD
          ) {
            return;
          }
          try {
            await performSync();
            await pullUserState(await dbPromise);
            this.hidden = await pruneStaleHidden(this.entries, now);
          } catch (err) {
            console.error("Partial sync failed", err);
          }
          /** replay any queued operations once we're back online */
        }, SYNC_INTERVAL);
      } catch (err) {
        console.error("loadFeed failed", err);
        this.errorMessage = "Could not load feed: " + err.message;
      } finally {
        // Ensure the loading spinner is removed on all paths
        this.loading = false;
      }
    },
    async syncPendingChanges() {
      if (!this.isOnline) return;
      try {
        await processPendingOperations();
      } catch (err) {
        console.error('syncPendingChanges failed', err);
      }
    },
    isHidden(link) { return isHidden(this, link); },
    toggleHidden(link) { return toggleHidden(this, link); },

    // computed, based on our three modes + the hidden[] list
    _lastFilterHash: "",
    _cachedFilteredEntries: null,  // Initialize as null instead of empty array

    // Modified getter
    get filteredEntries() {
      // Include entries.length in the hash to detect initial load
      const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}`;

      // Return cached value only if we have entries and hash matches
      if (this.entries.length > 0 &&
        currentHash === this._lastFilterHash &&
        this._cachedFilteredEntries !== null) {
        return this._cachedFilteredEntries;
      }

      // Existing filter logic
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
  }
};
document.addEventListener("load", e => {
  if (e.target.tagName.toLowerCase() === "img") {
    e.target.classList.add("loaded");
  }
}, true);
