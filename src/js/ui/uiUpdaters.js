// @filepath: src/js/ui/uiUpdaters.js

// Refactored JS: concise, modern, functional, same output.

import {
    getMainSettingsBlock,
    getRssSettingsBlock,
    getKeywordsSettingsBlock,
    getBackButton,
    getRssFeedsTextarea,
    getKeywordsBlacklistTextarea,
    getFilterSelector,
    getNtnTitleH2,
    getMessageContainer
} from './uiElements.js';
import { saveSimpleState } from '../data/database.js';

/**
 * Splits a message into two lines if it exceeds a character limit.
 * @param {string} message The full message to display.
 * @param {number} maxCharsPerLine Approximate maximum characters per line.
 * @returns {string[]} An array containing 1 or 2 lines of text.
*/
function splitMessageIntoLines(message, maxCharsPerLine = 30) {
    const words = message.split(' ');
    let line1 = [];
    let line2 = [];
    let currentLineLength = 0;

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
export async function displayTemporaryMessageInTitle(message) {
    const titleH2 = getNtnTitleH2();
    if (!titleH2) {
        console.warn("displayTemporaryMessageInTitle: 'ntn-title h2' element not found.");
        return;
    }

    const originalText = "NOT THE NEWS";
    const lines = splitMessageIntoLines(message);
    const originalOverflow = titleH2.style.overflow;
    titleH2.style.overflow = 'visible';

    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    titleH2.style.overflow = originalOverflow;
}

/**
 * Creates and shows a message in the dedicated status bar area using a closure for cleanup.
 * @param {string} message The message to display.
 * @param {string} [type='info'] Optional. 'success', 'error', 'info'.
*/
export const createStatusBarMessage = (() => {
    let messageTimeoutId;

    return (message, type = 'info') => {
        const messageContainer = getMessageContainer();
        if (!messageContainer) {
            console.warn("Message container not found. Cannot display status bar message.");
            return;
        }

        clearTimeout(messageTimeoutId);

        messageContainer.className = `message-container message-${type}`;
        messageContainer.textContent = message;
        messageContainer.style.display = 'block';

        messageTimeoutId = setTimeout(() => {
            messageContainer.style.display = 'none';
            messageContainer.textContent = '';
            messageContainer.className = 'message-container';
        }, 3000);
    };
})();

/**
 * Updates the counts displayed on filter options.
 * @param {object} app The Alpine.js app state object.
*/
export function updateCounts(app) {
    if (!app?.entries?.length || !app.hidden || !app.starred || !app.currentDeckGuids) {
        console.warn("Attempted to update counts with an invalid app object. Skipping.");
        return;
    }

    const hiddenSet = new Set(app.hidden.map(item => item.guid));
    const starredSet = new Set(app.starred.map(item => item.guid));
    // CHANGE: Per the new architecture, `app.currentDeckGuids` is an array of objects.
    // We must extract the `guid` from each object before creating the Set.
    const deckGuidsSet = new Set(app.currentDeckGuids.map(item => item.guid));
    const entries = app.entries;

    const allC = entries.length;
    const hiddenC = entries.filter(e => hiddenSet.has(e.guid)).length;
    const starredC = entries.filter(e => starredSet.has(e.guid)).length;
    const unreadInDeckC = entries.filter(e => deckGuidsSet.has(e.guid) && !hiddenSet.has(e.guid)).length;

    const selector = getFilterSelector();
    if (!selector) return;

    const counts = { all: allC, hidden: hiddenC, starred: starredC, unread: unreadInDeckC };
    Array.from(selector.options).forEach(opt => {
        // Retain the filter name (e.g., "All") and update the count
        const filterName = opt.text.split(' ')[0];
        opt.text = `${filterName} (${counts[opt.value] ?? 0})`;
    });
}

/**
 * Manages the display of different settings panels based on the app's modalView state.
 * @param {object} app The Alpine.js app state object.
*/
export async function manageSettingsPanelVisibility(app) {
    const panels = {
        main: getMainSettingsBlock(),
        rss: getRssSettingsBlock(),
        keywords: getKeywordsSettingsBlock()
    };
    const backBtn = getBackButton();
    const rssArea = getRssFeedsTextarea();
    const kwArea = getKeywordsBlacklistTextarea();

    // Hide all panels and the back button
    Object.values(panels).forEach(el => el && (el.style.display = 'none'));
    if (backBtn) backBtn.style.display = 'none';

    const panel = panels[app.modalView];
    if (panel) {
        panel.style.display = 'block';
        if (app.modalView !== 'main') {
            if (backBtn) backBtn.style.display = 'block';
        }
    }

    if (app.modalView === 'rss' && rssArea) rssArea.value = app.rssFeedsInput ?? '';
    if (app.modalView === 'keywords' && kwArea) kwArea.value = app.keywordBlacklistInput ?? '';
}

export function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

export const attachScrollToTopHandler = (() => {
    let inactivityTimeout;
    let previousScrollPosition = 0;

    return (buttonId = "scroll-to-top") => {
        const button = document.getElementById(buttonId);
        if (!button) return;

        const handleScroll = () => {
            const currentScrollPosition = window.scrollY;
            button.classList.toggle("visible", currentScrollPosition < previousScrollPosition && currentScrollPosition > 0);
            previousScrollPosition = currentScrollPosition;

            clearTimeout(inactivityTimeout);
            inactivityTimeout = setTimeout(() => button.classList.remove("visible"), 2000);
        };

        window.addEventListener("scroll", handleScroll);
        button.addEventListener("click", e => {
            e.preventDefault();
            scrollToTop();
        });
    };
})();

/**
 * Saves the current scroll position and the first visible item's GUID and offset.
 */
export async function saveCurrentScrollPosition() {
    let lastViewedItemId = '';
    let lastViewedItemOffset = 0;

    const entryElements = document.querySelectorAll('.entry[data-guid]');
    const firstVisibleEntry = Array.from(entryElements).find(el => {
        const rect = el.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom > 0;
    });

    if (firstVisibleEntry) {
        const rect = firstVisibleEntry.getBoundingClientRect();
        lastViewedItemId = firstVisibleEntry.dataset.guid;
        lastViewedItemOffset = rect.top;
    }

    await saveSimpleState('lastViewedItemId', lastViewedItemId);
    await saveSimpleState('lastViewedItemOffset', lastViewedItemOffset);
}