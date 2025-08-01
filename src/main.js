// main.js

import Alpine from 'alpinejs';

// Assuming you also need to import rss-parser.
// If you are using a minified version, the path might be slightly different.
// Vite should handle this import correctly.
import Parser from 'rss-parser';

// The following is an example of what your app logic might look like
// with Alpine and other dependencies properly imported.
// You will want to replace this with the actual content of your main.js file.

// This is the core Alpine data object for your application.
// It's exposed to the HTML via x-data="rssApp".
document.addEventListener('alpine:init', () => {
  Alpine.data('rssApp', () => ({
    loading: true,
    openSettings: false,
    modalView: 'main',
    filterMode: 'unread',
    shuffleCount: 0,
    syncEnabled: false,
    imagesEnabled: true,
    openUrlsInNewTabEnabled: false,
    rssFeedsInput: '',
    keywordBlacklistInput: '',
    entries: [],
    filteredEntries: [],
    starredGuids: new Set(),
    hiddenGuids: new Set(),

    initApp() {
      // Initialize your app logic here
      console.log('App initialized!');
      // Example of using the imported rss-parser
      const parser = new Parser();
      console.log('RSS Parser is ready:', parser);

      // Simulate a loading delay
      setTimeout(() => {
        this.loading = false;
      }, 1000);
    },

    processShuffle() {
      // Your shuffle logic
      this.shuffleCount++;
    },

    toggleHidden(id) {
      if (this.hiddenGuids.has(id)) {
        this.hiddenGuids.delete(id);
      } else {
        this.hiddenGuids.add(id);
      }
      this.updateFilteredEntries();
    },

    toggleStar(id) {
      if (this.starredGuids.has(id)) {
        this.starredGuids.delete(id);
      } else {
        this.starredGuids.add(id);
      }
      this.updateFilteredEntries();
    },

    setFilter(mode) {
      this.filterMode = mode;
      this.updateFilteredEntries();
    },

    updateFilteredEntries() {
      this.filteredEntries = this.entries.filter(entry => {
        if (this.filterMode === 'starred') return this.isStarred(entry.id);
        if (this.filterMode === 'hidden') return this.isHidden(entry.id);
        if (this.filterMode === 'unread') return !this.isHidden(entry.id);
        return true;
      });
    },

    isStarred(id) {
      return this.starredGuids.has(id);
    },

    isHidden(id) {
      return this.hiddenGuids.has(id);
    },

    handleEntryLinks(el) {
      // Your link handling logic
    },

    saveRssFeeds() {
      console.log('Saving RSS feeds...');
    },

    saveKeywordBlacklist() {
      console.log('Saving keyword blacklist...');
    },

    scrollToTop() {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

  }));
});

// PWA service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('Service Worker registered:', registration);
    }).catch(error => {
      console.log('Service Worker registration failed:', error);
    });
  });
}

// Start Alpine
Alpine.start();
