import { AppState } from '@/types/app.ts';
import { createStatusBarMessage } from '../ui/uiUpdaters.ts';

/**
 * Attempts to discover RSS/Atom feeds from a website URL via the backend API.
 * 
 * @param {string} url The website URL to scan.
 * @returns {Promise<{url: string, feeds: string[]}>} The discovery results.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;

async function fetchDiscoveryResults(url: string): Promise<any> {
    const response = await fetch(`${API_BASE_URL}/api/discover-source?url=${encodeURIComponent(url)}`);
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
            createStatusBarMessage(app, 'No RSS feeds found at this URL.');
        }
    } catch (error: any) {
        console.error('[Discovery] Error:', error);
        app.discoveryError = error.message;
    } finally {
        app.isDiscovering = false;
    }
}
