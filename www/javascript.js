if ('serviceWorker' in navigator) {
	navigator.serviceWorker.register('/sw.js').then(reg => {
		console.log('SW registered:', reg.scope);
		reg.addEventListener('updatefound', () => {
			const newSW = reg.installing;
			newSW.addEventListener('statechange', () => {
				if (newSW.state === 'activated') {
					window.location.reload();
				}
			});
		});
	}).catch(err => console.warn('SW registration failed:', err));
}

import { dbPromise, bufferedChanges, pushUserState, performSync, performFullSync, pullUserState, processPendingOperations, isStarred, toggleStar, isHidden, toggleHidden, loadHidden, loadStarred, pruneStaleHidden, saveCurrentDeck, loadCurrentDeck, saveShuffleState, loadShuffleState } from "./js/database.js";
import { scrollToTop, attachScrollToTopHandler, formatDate, setFilter, updateCounts, loadFilterMode, shuffleArray, mapRawItems } from "./js/functions.js";
import { initSync, initTheme, initImages, initScrollPos, initConfigComponent, loadSyncEnabled, loadImagesEnabled, initShuffleCount } from "./js/settings.js";

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
	shuffleCount: 2,
	currentSettingsPanel: 'main',
	autoSyncFeed: false,
	theme: 'light',
	isDarkTheme: false,
	rssFeedsInput: '',
	rssSaveMessage: '',
	keywordBlacklistInput: '',
	keywordsSaveMessage: '',
	loading: true,
	currentDeckGuids: [],

	scrollToTop,
	_attachScrollToTopHandler: attachScrollToTopHandler,
	formatDate,
	updateCounts,
	isStarred(link) {
		return isStarred(this, link);
	},
	toggleStar(link) {
		toggleStar(this, link);
	},
	setFilter(mode) {
		setFilter(this, mode);
	},

	async init() {
		this.loading = true;
		let serverTime = 0;
		try {
			this.syncEnabled = await loadSyncEnabled();
			this.imagesEnabled = await loadImagesEnabled();

			initTheme();
			initSync(this);
			initImages(this);

			await initShuffleCount(this);

			this.hidden = await loadHidden();
			this.starred = await loadStarred();
			this.currentDeckGuids = await loadCurrentDeck();

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
			window.addEventListener('offline', () => {
				this.isOnline = false;
			});
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
			const resetActivity = () => {
				lastActivity = Date.now();
			};
			["mousemove", "mousedown", "keydown", "scroll", "click"].forEach(evt => document.addEventListener(evt, resetActivity, true));
			document.addEventListener("visibilitychange", resetActivity, true);
			window.addEventListener("focus", resetActivity, true);

			const SYNC_INTERVAL = 5 * 60 * 1000;
			const IDLE_THRESHOLD = 60 * 1000;

			setInterval(async () => {
				const now = Date.now();
				if (this.openSettings || !this.syncEnabled || document.hidden || (now - lastActivity) > IDLE_THRESHOLD) {
					return;
				}
				try {
					await performSync();
					await pullUserState(await dbPromise);
					this.hidden = await pruneStaleHidden(this.entries, now);
				} catch (err) {
					console.error("Partial sync failed", err);
				}
			}, SYNC_INTERVAL);

			if (this.currentDeckGuids.length === 0) {
				await this.loadNextDeck();
			}
		} catch (err) {
			console.error("loadFeed failed", err);
			this.errorMessage = "Could not load feed: " + err.message;
		} finally {
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
	isHidden(link) {
		return isHidden(this, link);
	},
	async toggleHidden(link) {
		await toggleHidden(this, link);
		if (this.currentDeckGuids.includes(link)) {
			this.currentDeckGuids = this.currentDeckGuids.filter(guid => guid !== link);
			await saveCurrentDeck(this.currentDeckGuids);
			const unreadInDeck = this.currentDeckGuids.filter(guid => !this.hidden.some(h => h.id === guid));
			if (unreadInDeck.length === 0) {
				console.log("All items in current deck hidden. Loading next deck...");
				this.shuffleCount++;
				const today = new Date();
				today.setHours(0, 0, 0, 0);
				await saveShuffleState(this.shuffleCount, today);
				await this.loadNextDeck();
			}
		}
	},

	async loadNextDeck() {
		const db = await dbPromise;
		const allItems = await db.transaction('items', 'readonly').objectStore('items').getAll();
		const hiddenSet = new Set(this.hidden.map(h => h.id));
		const unreadItems = allItems.filter(item => !hiddenSet.has(item.guid))
			.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
		const nextDeck = unreadItems.slice(0, 10);
		this.currentDeckGuids = nextDeck.map(item => item.guid);
		await saveCurrentDeck(this.currentDeckGuids);
		this.updateCounts();
		this.scrollToTop();
	},

	async shuffleFeed() {
		if (this.shuffleCount <= 0) {
			console.log("No shuffles remaining today.");
			return;
		}
		const allUnreadItems = this.entries.filter(entry => !this.hidden.some(h => h.id === entry.id));
		const currentDeckGuidsSet = new Set(this.currentDeckGuids);
		const eligibleItemsForShuffle = allUnreadItems.filter(item => !currentDeckGuidsSet.has(item.id));
		if (eligibleItemsForShuffle.length === 0) {
			console.log("No new unread items available to shuffle into a deck.");
			return;
		}
		const shuffledEligibleItems = shuffleArray(eligibleItemsForShuffle);
		const newDeckItems = shuffledEligibleItems.slice(0, 10);
		this.currentDeckGuids = newDeckItems.map(item => item.id);
		await saveCurrentDeck(this.currentDeckGuids);
		this.shuffleCount--;
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		await saveShuffleState(this.shuffleCount, today);
		this.updateCounts();
		this.scrollToTop();
		this._cachedFilteredEntries = null;
		this.isShuffled = false;
		console.log(`Shuffled. Remaining shuffles: ${this.shuffleCount}`);
		const shuffleCountSpan = document.getElementById('shuffle-count-display');
		if (shuffleCountSpan) {
			shuffleCountSpan.textContent = this.shuffleCount;
		}
	},

	_lastFilterHash: "",
	_cachedFilteredEntries: null,

	get filteredEntries() {
		const currentHash = `${this.entries.length}-${this.filterMode}-${this.hidden.length}-${this.starred.length}-${this.imagesEnabled}-${this.currentDeckGuids.length}`;
		if (this.entries.length > 0 && currentHash === this._lastFilterHash && this._cachedFilteredEntries !== null) {
			return this._cachedFilteredEntries;
		}
		const hiddenMap = new Map(this.hidden.map(h => [h.id, h.hiddenAt]));
		const starredMap = new Map(this.starred.map(s => [s.id, s.starredAt]));
		let filtered = [];
		switch (this.filterMode) {
			case "all": filtered = this.entries; break;
			case "unread":
				const deckGuidsSet = new Set(this.currentDeckGuids);
				filtered = this.entries.filter(entry => deckGuidsSet.has(entry.id) && !hiddenMap.has(entry.id));
				break;
			case "hidden":
				filtered = this.entries.filter(entry => hiddenMap.has(entry.id))
					.sort((a, b) => new Date(hiddenMap.get(b.id)).getTime() - new Date(hiddenMap.get(a.id)).getTime());
				break;
			case "starred":
				filtered = this.entries.filter(entry => starredMap.has(entry.id))
					.sort((a, b) => new Date(starredMap.get(b.id)).getTime() - new Date(starredMap.get(a.id)).getTime());
				break;
			default: filtered = this.entries; break;
		}
		this._cachedFilteredEntries = filtered;
		this._lastFilterHash = currentHash;
		return this._cachedFilteredEntries;
	}
});
document.addEventListener("load", e => {
	if (e.target.tagName.toLowerCase() === "img") {
		e.target.classList.add("loaded");
	}
}, true);