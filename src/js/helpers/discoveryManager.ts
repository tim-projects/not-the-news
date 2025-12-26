import { AppState } from '@/types/app.ts';

/**
 * Attempts to discover RSS/Atom feeds from a website URL via the backend API.
 * 
 * @param {string} url The website URL to scan.
 * @returns {Promise<{url: string, feeds: string[]}>} The discovery results.
 */
export async function discoverFeedFromUrl(url: string): Promise<{url: string, feeds: string[]}> {
    const response = await fetch(`/api/discover-feed?url=${encodeURIComponent(url)}`);
    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Discovery failed with status ${response.status}`);
    }
    return response.json();
}

/**
 * Implements the discoverFeed action for the AppState.
 * 
 * @param {AppState} app The application state.
 */
export async function discoverFeed(app: AppState): Promise<void> {
    const url = app.discoveryUrl.trim();
    if (!url) return;

    app.isDiscovering = true;
    app.discoveryError = '';
    app.discoveryResults = [];

    try {
        const result = await discoverFeedFromUrl(url);
        app.discoveryResults = result.feeds;
        if (result.feeds.length === 0) {
            app.discoveryError = 'No feeds found on this website.';
        }
    } catch (error: any) {
        console.error('[Discovery] Error:', error);
        app.discoveryError = error.message;
    } finally {
        app.isDiscovering = false;
    }
}
