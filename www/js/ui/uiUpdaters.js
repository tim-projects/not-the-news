// www/js/ui/uiUpdaters.js

import { getMainSettingsBlock, getRssSettingsBlock, getKeywordsSettingsBlock, getBackButton, getRssFeedsTextarea, getKeywordsBlacklistTextarea, getFilterSelector } from './uiElements.js';
import { dbPromise, saveStateValue } from '../data/database.js';


/**
 * Creates and shows a temporary save message next to a button.
 * @param {HTMLElement} btn - The button element to place the message next to.
 * @param {string} msgId - The ID for the message span element.
 * @param {string} msgTxt - The text content of the message.
 */
export function createAndShowSaveMessage(btn, msgId, msgTxt) {
    // Add a check to ensure btn and its parent node exist
    if (!btn || !btn.parentNode) {
        console.warn("createAndShowSaveMessage: Target button or its parent not found, cannot display message.", { btn, msgId, msgTxt });
        return; // Exit the function if we can't place the message
    }

    let msgEl = document.getElementById(msgId);
    if (!msgEl) {
        msgEl = document.createElement("span");
        msgEl.id = msgId;
        msgEl.className = "save-message";
        msgEl.style.marginLeft = "0.5em";
        msgEl.style.display = "none";
        // Line 21: This line is now safe because btn.parentNode is checked
        btn.parentNode.insertBefore(msgEl, btn.nextSibling);
    }
    msgEl.textContent = msgTxt;
    msgEl.style.display = "inline";
    setTimeout(() => msgEl.style.display = "none", 2000);
}

/**
 * Updates the counts displayed on filter options (All, Hidden, Starred, Unread).
 * @param {object} app - The Alpine.js app state object.
 */
export function updateCounts(app) {
    const hiddenSet = new Set(app.hidden.map(e => e.id));
    const starredSet = new Set(app.starred.map(s => s.id));

    const allC = app.entries.length;
    const hiddenC = app.entries.filter(e => hiddenSet.has(e.id)).length;
    const starredC = app.entries.filter(e => starredSet.has(e.id)).length;
    const deckGuidsSet = new Set(app.currentDeckGuids);
    const unreadInDeckC = app.entries.filter(e => deckGuidsSet.has(e.id) && !hiddenSet.has(e.id)).length;

    const selector = getFilterSelector();
    if (!selector) return;

    Array.from(selector.options).forEach(opt => {
        switch (opt.value) {
            case 'all': opt.text = `All (${allC})`; break;
            case 'hidden': opt.text = `Hidden (${hiddenC})`; break;
            case 'starred': opt.text = `Starred (${starredC})`; break;
            case 'unread': opt.text = `Unread (${unreadInDeckC})`; break;
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
        case 'main': if (main) main.style.display = 'block'; break;
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
    const db = await dbPromise;
    const currentScrollY = window.scrollY;
    await saveStateValue(db, 'feedScrollY', String(currentScrollY));

    // Save the link of the first visible entry
    const entryElements = document.querySelectorAll('.entry');
    for (const entryElement of entryElements) {
        if (entryElement.getBoundingClientRect().top >= 0) {
            await saveStateValue(db, 'feedVisibleLink', entryElement.dataset.link || '');
            break;
        }
    }
}