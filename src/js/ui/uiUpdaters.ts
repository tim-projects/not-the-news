//
import { AppState } from '@/types/app.ts';

import {
    // @ts-ignore
    getMainSettingsBlock, 
    getFilterSelector,    // Will be typed later
    getNtnTitleH2
} from './uiElements.js'; // Will be converted later
import { saveSimpleState } from '../data/database.ts'; // Changed to .ts

// Minimal AppState interface for compilation, will be refined as app.ts is converted


/**
 * Splits a message into two lines if it exceeds a character limit.
 * @param {string} message The full message to display.
 * @param {number} maxCharsPerLine Approximate maximum characters per line.
 * @returns {string[]} An array containing 1 or 2 lines of text.
*/
function splitMessageIntoLines(message: string, maxCharsPerLine: number = 30): string[] {
    const words = message.split(' ');
    let line1: string[] = [];
    let line2: string[] = [];
    let currentLineLength: number = 0;

    for (const word of words) {
        const wordLength = word.length + (line1.length > 0 ? 1 : 0);
        if (currentLineLength + wordLength <= maxCharsPerLine) {
            line1.push(word);
            currentLineLength += wordLength;
        } else {
            line2.push(word);
        }
    }
    return [line1.join(' '), line2.join(' ')].filter(Boolean);
}

/**
 * Displays a temporary status message in the title and reverts after a delay.
 * @param {string} message The message text to display.
*/
export async function displayTemporaryMessageInTitle(message: string): Promise<void> {
    const titleH2 = getNtnTitleH2();
    if (!titleH2) {
        console.warn("displayTemporaryMessageInTitle: 'ntn-title h2' element not found.");
        return;
    }

    const originalText: string = "NOT THE NEWS";
    const lines: string[] = splitMessageIntoLines(message);
    const originalOverflow: string = (titleH2 as HTMLElement).style.overflow;
    (titleH2 as HTMLElement).style.overflow = 'visible'; // Cast to HTMLElement to access style

    const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    if (lines.length > 0) {
        titleH2.textContent = lines[0];
        await delay(1500);
    }
    if (lines.length > 1) {
        titleH2.textContent = lines.join(' ');
        await delay(1500);
    } else if (lines.length === 1) {
        await delay(1500);
    }

    titleH2.textContent = originalText;
    (titleH2 as HTMLElement).style.overflow = originalOverflow; // Cast to HTMLElement to access style
}

/**
 * Creates and shows a message in the dedicated status bar area using Alpine.js state.
 * @param {object} app The Alpine.js app state object.
 * @param {string} message The message to display.
 * @param {string} [type='info'] Optional. 'success', 'error', 'info'.
*/
let messageTimeoutId: any;
export function createStatusBarMessage(app: AppState, message: string): void {
    console.log(`[Status] ${message}`);
    if (messageTimeoutId) {
        clearTimeout(messageTimeoutId);
    }

    app.syncStatusMessage = message;
    
    // Ensure the message is updated in the DOM before we trigger the CSS transition
    const triggerShow = () => {
        app.showSyncStatus = true;
        messageTimeoutId = setTimeout(() => {
            app.showSyncStatus = false;
            // Clear message text only after it's hidden to avoid a jarring empty box
            setTimeout(() => {
                if (!app.showSyncStatus) app.syncStatusMessage = '';
            }, 300);
        }, 5000);
    };

    if ((app as any).$nextTick) {
        (app as any).$nextTick(triggerShow);
    } else {
        triggerShow();
    }
}

/**
 * Shows an undo notification with a countdown.
 * @param {AppState} app The Alpine.js app state.
 * @param {string} guid The GUID of the item to potentially undo.
 */
let undoTimeoutId: any;
export function showUndoNotification(app: AppState, guid: string): void {
    if (undoTimeoutId) {
        clearTimeout(undoTimeoutId);
    }

    app.undoItemGuid = guid;
    app.showUndo = true;

    undoTimeoutId = setTimeout(() => {
        app.showUndo = false;
        setTimeout(() => {
            if (!app.showUndo) app.undoItemGuid = null;
        }, 500); // Wait for fade out animation
    }, 5000);
}

/**
 * Manages the visibility of different settings panels based on the current modal view.
 * @param {object} app The Alpine.js app state object.
 */
export function manageSettingsPanelVisibility(app: AppState): Promise<void> {
    const mainSettings = document.getElementById('main-settings');
    const rssSettings = document.getElementById('rss-settings-block');
    const keywordsSettings = document.getElementById('keywords-settings-block');

    if (!mainSettings || !rssSettings || !keywordsSettings) {
        console.warn('One or more settings panels not found.');
        return Promise.resolve();
    }

    // Hide all panels initially
    mainSettings.style.display = 'none';
    rssSettings.style.display = 'none';
    keywordsSettings.style.display = 'none';

    // Show the appropriate panel based on modalView
    switch (app.modalView) {
        case 'main':
            mainSettings.style.display = 'block';
            break;
        case 'rss':
            rssSettings.style.display = 'block';
            break;
        case 'keywords':
            keywordsSettings.style.display = 'block';
            break;
        default:
            console.warn('Unknown modalView:', app.modalView);
            mainSettings.style.display = 'block'; // Fallback
    }

    return Promise.resolve();
}

/**
 * Updates the counts displayed on filter options.
 * @param {object} app The Alpine.js app state object.
*/
export async function updateCounts(app: AppState): Promise<void> {
    if (!app?.entries?.length || !app.read || !app.starred || !app.currentDeckGuids) {
        console.warn("Attempted to update counts with an invalid app object. Skipping.");
        return;
    }

    const readSet = new Set(app.read.map(item => item.guid));
    const starredSet = new Set(app.starred.map(item => item.guid));
    // CHANGE: Per the new architecture, `app.currentDeckGuids` is an array of objects.
    // We must extract the `guid` from each object before creating the Set.
    const deckGuidsSet = new Set(app.currentDeckGuids.map(item => item.guid));
    const entries = app.entries;

    const allC = entries.length;
    const readC = entries.filter(e => readSet.has(e.guid)).length;
    const starredC = entries.filter(e => starredSet.has(e.guid)).length;
    const unreadInDeckC = entries.filter(e => deckGuidsSet.has(e.guid) && !readSet.has(e.guid)).length;

    const selector = getFilterSelector();
    if (!selector) return;

    const counts: { [key: string]: number } = { all: allC, read: readC, starred: starredC, unread: unreadInDeckC };
    Array.from((selector as HTMLSelectElement).options as HTMLOptionsCollection).forEach((opt: HTMLOptionElement) => {
        // Retain the filter name (e.g., "All") and update the count
        const filterName = opt.text.split(' ')[0];
        opt.text = `${filterName} (${counts[opt.value] ?? 0})`;
    });
}



export function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

export const attachScrollToTopHandler = (() => {
    let inactivityTimeout: NodeJS.Timeout | undefined;
    let previousScrollPosition: number = 0;

    return (buttonId: string = "scroll-to-top"): void => {
        const button = document.getElementById(buttonId) as HTMLElement | null;
        if (!button) return;

        const handleScroll = (): void => {
            const currentScrollPosition: number = window.scrollY;
            button.classList.toggle("visible", currentScrollPosition < previousScrollPosition && currentScrollPosition > 0);
            previousScrollPosition = currentScrollPosition;

            clearTimeout(inactivityTimeout);
            inactivityTimeout = setTimeout(() => button.classList.remove("visible"), 2000);
        };

        window.addEventListener("scroll", handleScroll);
        button.addEventListener("click", (e: Event) => {
            e.preventDefault();
            scrollToTop();
        });
    };
})();

/**
 * Saves the current scroll position and the first visible item's GUID and offset.
 */
export async function saveCurrentScrollPosition(): Promise<void> {
    let lastViewedItemId: string = '';
    let lastViewedItemOffset: number = 0;

    const entryElements: NodeListOf<HTMLElement> = document.querySelectorAll('.entry[data-guid]');
    const firstVisibleEntry = Array.from(entryElements).find((el: HTMLElement) => {
        const rect: DOMRect = el.getBoundingClientRect();
        // Pick the first element that is at least partially in or below the viewport.
        // rect.bottom > 0 means the bottom of the element is below the top of the viewport.
        return rect.bottom > 0;
    });

    if (firstVisibleEntry) {
        const rect: DOMRect = firstVisibleEntry.getBoundingClientRect();
        lastViewedItemId = (firstVisibleEntry as HTMLElement).dataset.guid || '';
        lastViewedItemOffset = rect.top;
    }

    await saveSimpleState('lastViewedItemId', lastViewedItemId);
    await saveSimpleState('lastViewedItemOffset', lastViewedItemOffset);
}
