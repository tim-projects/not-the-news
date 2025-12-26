import { AppState, MappedFeedItem } from '@/types/app.ts';

/**
 * Filters an array of feed items based on a search query.
 * Matches against titles and descriptions.
 * 
 * @param {MappedFeedItem[]} entries The entries to filter.
 * @param {string} query The search query string.
 * @returns {MappedFeedItem[]} The filtered entries.
 */
export function filterEntriesByQuery(entries: MappedFeedItem[], query: string): MappedFeedItem[] {
    if (!query || query.trim() === '') {
        return entries;
    }

    const searchTerms = query.toLowerCase().trim().split(/\s+/);
    
    return entries.filter(item => {
        const title = (item.title || '').toLowerCase();
        const description = (item.description || '').toLowerCase();
        const content = `${title} ${description}`;
        
        // Every search term must be present in the content
        return searchTerms.every(term => content.includes(term));
    });
}

/**
 * Toggles the search bar visibility.
 * If opening, it resets the query and attempts to focus the input.
 * 
 * @param {AppState} app The application state.
 */
export function toggleSearch(app: AppState): void {
    app.showSearchBar = !app.showSearchBar;
    
    if (app.showSearchBar) {
        app.searchQuery = '';
        // Use nextTick to ensure the input is visible before focusing
        app.$nextTick(() => {
            const searchInput = document.getElementById('search-input') as HTMLInputElement;
            if (searchInput) {
                searchInput.focus();
            }
        });
    } else {
        app.searchQuery = '';
    }
}
