// Centralized DOM element access for reuse

export const getSyncToggle = () => document.getElementById('sync-toggle');
export const getSyncText = () => document.getElementById('sync-text');
export const getImagesToggle = () => document.getElementById('images-toggle');
export const getImagesText = () => document.getElementById('images-text');
export const getThemeToggle = () => document.getElementById('theme-toggle');
export const getThemeText = () => document.getElementById('theme-text');
export const getShuffleCountDisplay = () => document.getElementById('shuffle-count-display');
export const getFilterSelector = () => document.getElementById('filter-selector');

// Settings panel elements
export const getMainSettingsBlock = () => document.getElementById('main-settings');
export const getRssSettingsBlock = () => document.getElementById('rss-settings-block');
export const getKeywordsSettingsBlock = () => document.getElementById('keywords-settings-block');
export const getBackButton = () => document.getElementById('back-button');
export const getRssFeedsTextarea = () => document.getElementById("rss-feeds-textarea");
export const getKeywordsBlacklistTextarea = () => document.getElementById("keywords-blacklist-textarea");

// Buttons for config
export const getConfigureRssButton = () => document.getElementById('configure-rss-feeds-btn');
export const getConfigureKeywordsButton = () => document.getElementById('configure-keyword-blacklist-btn');
export const getSaveKeywordsButton = () => document.getElementById("save-keywords-btn");
export const getSaveRssButton = () => document.getElementById("save-rss-btn");

export const getScrollToTopButton = () => document.getElementById("scroll-to-top");

// status bar
export function getNtnTitleH2() {
    return document.querySelector('.ntn-title h2');
}
export function getMessageContainer() {
    // This assumes you have an element with id="status-bar-message" in your HTML
    return document.getElementById('status-bar-message');
}