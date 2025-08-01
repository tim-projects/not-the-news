// www/js/ui/uiUpdaters.js

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
import { getDb, saveSimpleState } from '../data/database.js'; // getDb isn't used in this file. saveSimpleState is.

/**
 * Splits a message into two lines if it exceeds a certain character limit.
 * This is a heuristic and might need adjustment based on font/viewport.
 * @param {string} message - The full message to display.
 * @param {number} maxCharsPerLine - Approximate maximum characters per line.
 * @returns {string[]} An array containing 1 or 2 lines of text.
*/
function splitMessageIntoLines(message, maxCharsPerLine = 30) {
    const words = message.split(' ');
    let line1 = [];
    let line2 = [];
    let currentLineLength = 0;

    for (const word of words) {
        if (currentLineLength + word.length + (line1.length > 0 ? 1 : 0) <= maxCharsPerLine) {
            line1.push(word);
            currentLineLength += word.length + (line1.length > 1 ? 1 : 0);
        } else {
            line2.push(word);
        }
    }

    // If line2 is too short, or line1 too long, try to balance
    if (line1.length > 0 && line2.length > 0 && line1.join(' ').length > maxCharsPerLine && line2.join(' ').length < maxCharsPerLine / 2) {
        // Simple redistribution: move one word from line1 to line2 if it helps balance
        const lastWordLine1 = line1.pop();
        if (lastWordLine1) {
            line2.unshift(lastWordLine1);
        }
    }

    return [line1.join(' '), line2.join(' ')].filter(Boolean); // Filter out empty strings
}

/**
 * Displays a temporary status message by replacing the `ntn-title h2` text.
 * The message will be split into lines if too long, and revert to original after a delay.
 * @param {string} message - The message text to display.
*/
export async function displayTemporaryMessageInTitle(message) {
    const titleH2 = getNtnTitleH2();
    if (!titleH2) {
        console.warn("displayTemporaryMessageInTitle: 'ntn-title h2' element not found.");
        return;
    }

    const originalText = "NOT THE NEWS"; // The fixed original text for the title
    const lines = splitMessageIntoLines(message);

    // Store the original overflow style to restore it later
    const originalOverflow = titleH2.style.overflow;
    titleH2.style.overflow = 'visible'; // Allow text to wrap if it somehow gets stuck

    // Ensure initial display is empty or first part
    titleH2.textContent = '';

    // Step 1: Display first line
    if (lines.length > 0) {
        titleH2.textContent = lines[0];
        await new Promise(resolve => setTimeout(resolve, 1500)); // Display first line for 1.5 seconds
    }

    // Step 2: Display second line if it exists
    if (lines.length > 1) {
        // Concatenate with space if both lines exist and aren't empty
        titleH2.textContent = [lines[0], lines[1]].filter(Boolean).join(' ');
        await new Promise(resolve => setTimeout(resolve, 1500)); // Display full message for 1.5 seconds
    } else if (lines.length === 1) {
        // If only one line, ensure it stays for total 3 seconds (1.5s + 1.5s)
        await new Promise(resolve => setTimeout(resolve, 1500));
    }

    // Step 3: Revert to original text
    titleH2.textContent = originalText;
    titleH2.style.overflow = originalOverflow; // Restore original overflow style
}

let messageTimeout; // To clear previous timeouts for the status bar message

/**
 * Creates and shows a message in the dedicated status bar area.
 * It clears previous messages and hides after a delay.
 * @param {string} message The message to display.
 * @param {string} type Optional. 'success', 'error', 'info'. Determines styling.
*/
export function createStatusBarMessage(message, type = 'info') {
    const messageContainer = getMessageContainer();
    if (!messageContainer) {
        console.warn("Message container not found. Cannot display status bar message.");
        return;
    }

    // Clear any existing timeout to prevent messages from disappearing too early
    clearTimeout(messageTimeout);

    // Clear previous classes and content
    messageContainer.className = 'message-container'; // Reset classes
    messageContainer.textContent = message;
    messageContainer.classList.add(`message-${type}`);
    messageContainer.style.display = 'block'; // Make sure it's visible

    // Hide the message after a few seconds
    messageTimeout = setTimeout(() => {
        messageContainer.style.display = 'none';
        messageContainer.textContent = ''; // Clear text
        messageContainer.className = 'message-container'; // Reset classes
    }, 3000); // Message disappears after 3 seconds
}


/**
 * Updates the counts displayed on filter options (All, Hidden, Starred, Unread).
 * @param {object} app - The Alpine.js app state object.
*/
export function updateCounts(app) {
    // CRITICAL FIX: Add a defensive check to ensure the 'app' object is valid
    if (!app || typeof app.entries === 'undefined' || typeof app.hidden === 'undefined' || typeof app.starred === 'undefined') {
        console.warn("Attempted to update counts with an invalid app object. Skipping to prevent errors.");
        return;
    }
    
    // app.hidden and app.starred now contain objects like { guid: '...', hiddenAt: '...' }
    // or { guid: '...', starredAt: '...' }.
    // app.entries items have a 'guid' property.
    // app.currentDeckGuids is an array of plain GUID strings.

    const hiddenSet = new Set(app.hidden.map(e => e.guid));
    const starredSet = new Set(app.starred.map(s => s.guid));

    const allC = app.entries.length;
    // Filter app.entries using their 'guid' property against the sets
    const hiddenC = app.entries.filter(e => hiddenSet.has(e.guid)).length;
    const starredC = app.entries.filter(e => starredSet.has(e.guid)).length;

    // app.currentDeckGuids is already an array of GUID strings
    const deckGuidsSet = new Set(app.currentDeckGuids);
    // Unread items are those in the current deck that are NOT hidden.
    const unreadInDeckC = app.entries.filter(e => deckGuidsSet.has(e.guid) && !hiddenSet.has(e.guid)).length;

    const selector = getFilterSelector();
    if (!selector) return;

    Array.from(selector.options).forEach(opt => {
        switch (opt.value) {
            case 'all':
                opt.text = `All (${allC})`;
                break;
            case 'hidden':
                opt.text = `Hidden (${hiddenC})`;
                break;
            case 'starred':
                opt.text = `Starred (${starredC})`;
                break;
            case 'unread':
                opt.text = `Unread (${unreadInDeckC})`;
                break;
        }
    });
}

/**
 * Manages the display of different settings panels based on the app's modalView state.
 * @param {object} app - The Alpine.js app state object.
*/
export async function manageSettingsPanelVisibility(app) {
    const main = getMainSettingsBlock();
    const rss = getRssSettingsBlock();
    const keywords = getKeywordsSettingsBlock();
    const backBtn = getBackButton();
    const rssArea = getRssFeedsTextarea();
    const kwArea = getKeywordsBlacklistTextarea();

    // Hide all panels and back button initially
    if (main) main.style.display = 'none';
    if (rss) rss.style.display = 'none';
    if (keywords) keywords.style.display = 'none';
    if (backBtn) backBtn.style.display = 'none';

    switch (app.modalView) {
        case 'main':
            if (main) main.style.display = 'block';
            break;
        case 'rss':
            if (rss) rss.style.display = 'block';
            if (backBtn) backBtn.style.display = 'block';
            if (rssArea && app.rssFeedsInput !== undefined) {
                rssArea.value = app.rssFeedsInput;
            }
            break;
        case 'keywords':
            if (keywords) keywords.style.display = 'block';
            if (backBtn) backBtn.style.display = 'block';
            if (kwArea && app.keywordBlacklistInput !== undefined) {
                kwArea.value = app.keywordBlacklistInput;
            }
            break;
    }
}

export function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
}

export function attachScrollToTopHandler(buttonId = "scroll-to-top") {
    const button = document.getElementById(buttonId);
    if (!button) return;

    let inactivityTimeout = null;
    let previousScrollPosition = window.scrollY; // Track previous scroll position

    window.addEventListener("scroll", () => {
        const currentScrollPosition = window.scrollY;
        // Show button only if scrolling up
        if (currentScrollPosition < previousScrollPosition) {
            button.classList.add("visible");
        } else {
            button.classList.remove("visible");
        }
        previousScrollPosition = currentScrollPosition; // Update previous scroll position

        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(() => {
            button.classList.remove("visible");
        }, 2000); // Hide after 2 seconds of inactivity
    });

    button.addEventListener("click", (e) => {
        e.preventDefault();
        scrollToTop();
    });
}

export async function saveCurrentScrollPosition() {
    let lastViewedItemId = ''; // This will store the GUID of the last viewed item.
    let lastViewedItemOffset = 0; // This will store the scroll offset within that item.

    // Find the GUID of the first entry element whose top is at or above the viewport's top.
    const entryElements = document.querySelectorAll('.entry[data-guid]');
    for (const entryElement of entryElements) {
        const rect = entryElement.getBoundingClientRect();

        // If the top of the entry is visible (at or above the viewport's top)
        // and at least partially visible (bottom is below top of viewport)
        if (rect.top >= 0 && rect.bottom > 0) { // rect.bottom > 0 ensures it's not entirely off-screen above
            lastViewedItemId = entryElement.dataset.guid;
            // Calculate offset from the top of the entry to the top of the viewport
            lastViewedItemOffset = rect.top; // This is the scroll position *within* the item
            break; // Found the first visible item from the top, stop searching
        }
    }

    // Save both the lastViewedItemId (GUID string) and its scroll offset to IndexedDB.
    await saveSimpleState('lastViewedItemId', lastViewedItemId);
    await saveSimpleState('lastViewedItemOffset', lastViewedItemOffset); // Save the offset
}