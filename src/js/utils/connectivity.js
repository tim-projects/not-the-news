// @filepath: src/js/utils/connectivity.js

// Provides a centralized function to check the online status.

/**
 * Checks if the browser is currently online.
 * @returns {boolean} True if the browser is online, false otherwise.
 */
export const isOnline = () => navigator.onLine;