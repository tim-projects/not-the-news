import { AppState, MappedFeedItem } from '@/types/app.ts';
import { getAllFeedItems } from '../data/dbSyncOperations.ts';
import { mapRawItems, parseRssFeedsConfig, formatDate } from '../helpers/dataUtils.ts';
import { loadSimpleState, saveSimpleState } from '../data/dbUserState.ts';
import { createStatusBarMessage } from '../ui/uiUpdaters.ts';
import { performFullSync } from '../data/dbSyncOperations.ts'; // Correct path for now
import { manageDailyDeck } from '../helpers/deckManager.ts';
import { discoverFeed as helperDiscover } from '../helpers/discoveryManager.ts';
import { loadAndDisplayDeck } from './deck.ts';
import { selectItem } from './interaction.ts';
import { filterEntriesByQuery } from '../helpers/searchManager.ts';
import { getAuthToken } from '../data/dbAuth.ts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

export async function loadFeedItemsFromDB(app: AppState): Promise<void> {
    if (!app.db) {
        app.entries = [];
        app.feedItems = {};
        return;
    }
    const rawItemsFromDb = await getAllFeedItems();
    app.feedItems = {};
    const uniqueEntries: any[] = [];
    const seenGuids = new Set<string>();

    rawItemsFromDb.forEach(item => {
        if (item && item.guid && !seenGuids.has(item.guid.toLowerCase())) {
            app.feedItems[item.guid.toLowerCase()] = item;
            uniqueEntries.push(item);
            seenGuids.add(item.guid.toLowerCase());
        }
    });

    app.entries = mapRawItems(uniqueEntries, formatDate) || [];
}

export function computeFilteredEntries(app: AppState): MappedFeedItem[] {
    if (!Array.isArray(app.deck)) app.deck = [];
    
    const deckContentHash = app.deck.length > 0 ? app.deck[0].guid.substring(0, 8) : 'empty';
    const currentHash = `${app.entries.length}-${app.filterMode}-${app.read.length}-${app.starred.length}-${app.imagesEnabled}-${app.currentDeckGuids.length}-${app.deck.length}-${app.keywordBlacklistInput}-${app.searchQuery}-${deckContentHash}`;
    
    if (app.entries.length > 0 && currentHash === app._lastFilterHash && app._cachedFilteredEntries !== null) {
        return app._cachedFilteredEntries;
    }

    let filtered: MappedFeedItem[] = [];
    const readMap = new Map(app.read.map(h => [h.guid.toLowerCase(), h.readAt]));
    const starredMap = new Map(app.starred.map(s => [s.guid.toLowerCase(), s.starredAt]));

    switch (app.filterMode) {
        case "unread":
            filtered = app.deck.filter(item => !readMap.has(item.guid.toLowerCase()));
            break;
        case "all":
            filtered = app.entries;
            break;
        case "read":
            filtered = app.entries.filter(e => readMap.has(e.guid.toLowerCase()))
                .sort((a, b) => (new Date(readMap.get(b.guid.toLowerCase()) || 0).getTime()) - (new Date(readMap.get(a.guid.toLowerCase()) || 0).getTime()));
            break;
        case "starred":
            filtered = app.entries.filter(e => starredMap.has(e.guid.toLowerCase()))
                .sort((a, b) => (new Date(starredMap.get(b.guid.toLowerCase()) || 0).getTime()) - (new Date(starredMap.get(a.guid.toLowerCase()) || 0).getTime()));
            break;
    }

    filtered = filtered.map(e => {
        const g = e.guid.toLowerCase();
        return {
            ...e,
            isRead: readMap.has(g),
            isStarred: starredMap.has(g)
        };
    });

    // Apply Keyword Blacklist
    const keywordBlacklist = (app.keywordBlacklistInput ?? '')
        .split(/\r?\n/)
        .map(kw => kw.trim().toLowerCase())
        .filter(kw => kw.length > 0);
    
    if (keywordBlacklist.length > 0) {
        filtered = filtered.filter(item => {
            const searchable = `${item.title} ${item.description} ${item.guid}`.toLowerCase();
            return !keywordBlacklist.some(keyword => searchable.includes(keyword));
        });
    }

    // Apply Search Query
    filtered = filterEntriesByQuery(filtered, app.searchQuery);
    
    app._cachedFilteredEntries = filtered;
    app._lastFilterHash = currentHash;
    return filtered;
}

export async function loadRssFeeds(app: AppState): Promise<void> {
    try {
        const result = await loadSimpleState('rssFeeds');
        app.rssFeedsInput = parseRssFeedsConfig(result.value).join('\n');
        console.log(`[DEBUG] Content for rssFeeds input: ${app.rssFeedsInput}`);
    } catch (error) {
        console.error('Error loading RSS feeds:', error);
    }
}

export async function saveRssFeeds(app: AppState): Promise<void> {
    if (app.isDemo) {
        app.showCta = true;
        return;
    }
    const lines = app.rssFeedsInput.split(/\r?\n/);
    const normalizedLines = lines.map(line => {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith('#')) return line;
        
        // If it looks like a URL but has no protocol, add https://
        if (!trimmed.includes('://') && trimmed.includes('.')) {
            return `https://${trimmed}`;
        }
        return line;
    });

    const rssFeedsArray = normalizedLines.map(url => url.trim());
    
    // Check if anything has actually changed to avoid redundant syncs
    const { value: currentFeeds } = await loadSimpleState('rssFeeds');
    const currentArray = parseRssFeedsConfig(currentFeeds);
    const isSame = currentArray.length === rssFeedsArray.filter(u => u && !u.startsWith('#')).length && 
                   rssFeedsArray.filter(u => u && !u.startsWith('#')).every(u => currentArray.includes(u));
    
    if (isSame) {
        console.log('[saveRssFeeds] No changes detected, skipping save and sync.');
        createStatusBarMessage(app, 'No changes to feeds.');
        return;
    }

    // Validate URLs
    const invalidUrls: string[] = [];
    rssFeedsArray.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('#')) {
            try {
                const url = new URL(trimmed);
                if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                    invalidUrls.push(line);
                }
            } catch {
                invalidUrls.push(line);
            }
        }
    });

    if (invalidUrls.length > 0) {
        const proceed = confirm(`The following URLs appear to be invalid:\n\n${invalidUrls.slice(0, 5).join('\n')}${invalidUrls.length > 5 ? '\n...and more' : ''}\n\nInvalid URLs will be saved but ignored by the sync process. Proceed anyway?`);
        if (!proceed) return;
    }

    try {
        await saveSimpleState('rssFeeds', rssFeedsArray, 'userSettings', app);
        app.rssFeedsInput = normalizedLines.join('\n');
        app._initialRssFeedsInput = app.rssFeedsInput;
        createStatusBarMessage(app, 'RSS Feeds saved!');
        app.loading = true;
        app.progressMessage = 'Saving feeds and performing full sync...';
        
        // Trigger worker to start fetching these new feeds immediately
        const token = await getAuthToken();
        if (token) {
            await fetch(`${API_BASE_URL}/api/refresh`, { 
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            }).catch(e => console.error('[Worker Sync] Immediate sync failed:', e));
        }

        const syncSuccess = await performFullSync(app);
        await loadFeedItemsFromDB(app);
        
        const deckResult = await manageDailyDeck(
            Array.from(app.entries), app.read, app.starred, app.shuffledOutGuids,
            app.shuffleCount, app.filterMode, app.lastShuffleResetDate,
            null, // No pregen deck for manual save
            app
        );
        
        app.deck = deckResult.deck;
        app.currentDeckGuids = deckResult.currentDeckGuids;
        app.shuffledOutGuids = deckResult.shuffledOutGuids;
        app.shuffleCount = deckResult.shuffleCount;
        app.lastShuffleResetDate = deckResult.lastShuffleResetDate;

        await loadAndDisplayDeck(app);
        
        if (app.deck.length > 0) {
            selectItem(app, app.deck[0].guid);
        }

        app.progressMessage = '';
        app.loading = false;
        if (!syncSuccess) {
            createStatusBarMessage(app, 'Feeds saved, but sync finished with errors.');
        }
    } catch (error: any) {
        console.error('Error saving RSS feeds:', error);
        createStatusBarMessage(app, `Failed to save RSS feeds: ${error.message}`);
        app.loading = false;
    }
}

export async function loadKeywordBlacklist(app: AppState): Promise<void> {
    const { value } = await loadSimpleState('keywordBlacklist');
    app.keywordBlacklistInput = Array.isArray(value) ? value.join('\n') : '';
    console.log(`[DEBUG] Content for keywordBlacklist input: ${app.keywordBlacklistInput}`);
}

export async function saveKeywordBlacklist(app: AppState): Promise<void> {
    if (app.isDemo) {
        app.showCta = true;
        return;
    }
    const keywordsArray = app.keywordBlacklistInput.split(/\r?\n/).map(kw => kw.trim().toLowerCase()).filter(Boolean).sort();
    
    // Check if anything changed
    const { value: currentBlacklist } = await loadSimpleState('keywordBlacklist');
    const currentArray = Array.isArray(currentBlacklist) ? [...currentBlacklist].sort() : [];
    const isSame = currentArray.length === keywordsArray.length && 
                   keywordsArray.every((kw, idx) => kw === currentArray[idx]);

    if (isSame) {
        console.log('[saveKeywordBlacklist] No changes detected, skipping save.');
        createStatusBarMessage(app, 'No changes to blacklist.');
        return;
    }

    try {
        await saveSimpleState('keywordBlacklist', keywordsArray, 'userSettings', app);
        app.keywordBlacklistInput = keywordsArray.join('\n');
        app._initialKeywordBlacklistInput = app.keywordBlacklistInput;
        createStatusBarMessage(app, 'Keyword Blacklist saved!');
        // Update counts as filtering might change
        if (app.updateAllUI) app.updateAllUI();
    } catch (error: any) {
        console.error('Error saving keyword blacklist:', error);
        createStatusBarMessage(app, `Failed to save keyword blacklist: ${error.message}`);
    }
}

export async function discoverFeed(app: AppState): Promise<void> {
    await helperDiscover(app);
}
