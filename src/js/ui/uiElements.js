// @filepath: src/js/ui/uiElements.js

// Refactored JS: concise, modern, functional, same output.

/**
 * Centralized DOM element access for reuse across the application.
 * Using arrow functions provides a concise and consistent syntax.
 */

// Toggle elements for settings
export const getSyncToggle = () => document.getElementById('sync-toggle');
export const getSyncText = () => document.getElementById('sync-text');
export const getImagesToggle = () => document.getElementById('images-toggle');
export const getImagesText = () => document.getElementById('images-text');
export const getThemeToggle = () => document.getElementById('theme-toggle');
export const getThemeText = () => document.getElementById('theme-text');

// Display elements
export const getShuffleCountDisplay = () => document.getElementById('shuffle-count-display');
export const getFilterSelector = () => document.getElementById('filter-selector');
export const getScrollToTopButton = () => document.getElementById("scroll-to-top");
export const getNtnTitleH2 = () => document.querySelector('#ntn-title h2');
export const getMessageContainer = () => document.getElementById('status-message-container');

// Settings panel and button elements
export const getMainSettingsBlock = () => document.getElementById('main-settings');
export const getRssSettingsBlock = () => document.getElementById('rss-settings-block');
export const getKeywordsSettingsBlock = () => document.getElementById('keywords-settings-block');
export const getBackButton = () => document.getElementById('back-button');

// Textarea elements within the settings panels
export const getRssFeedsTextarea = () => {
    const el = document.querySelector('#rss-settings-block textarea');
    console.log('[DEBUG] getRssFeedsTextarea called. Element:', el);
    return el;
};
export const getKeywordsBlacklistTextarea = () => {
    const el = document.querySelector('#keywords-settings-block textarea');
    console.log('[DEBUG] getKeywordsBlacklistTextarea called. Element:', el);
    return el;
};

// Buttons for navigating and saving configuration
export const getConfigureRssButton = () => document.getElementById('configure-rss-feeds-btn');
export const getConfigureKeywordsButton = () => document.getElementById('configure-keyword-blacklist-btn');
export const getSaveKeywordsButton = () => document.getElementById("save-keywords-btn");
export const getSaveRssButton = () => document.getElementById("save-rss-btn");
export const getReadToggleButton = () => document.querySelector('.read-toggle');