// @filepath: src/js/helpers/apiUtils.js

// @refactor-directive
// Refactor JS: concise, modern, functional, same output.
/**
 * @file API utility functions for interacting with server-side configuration endpoints.
 * @module apiUtils
 * @description
 * This module provides functions to load and save application-wide configuration files
 * from and to the server's designated configuration directory. These are typically
 * static files (e.g., text lists, JSON configurations) that influence server-side
 * behavior or provide global settings for the client.
 *
 * It is important to distinguish these configuration files from dynamic user state
 * (like starred/hidden items or deck GUIDs) which are managed through separate,
 * potentially more granular, user-state specific API endpoints.
 *
 * Note: This file currently uses standard `fetch` for network requests.
 * If a global `fetchWithRetry` utility from `database.js` (or similar) is intended
 * to centralize API call robustness, these functions should be updated to utilize it.
 */

/**
 * Loads the content of a specified configuration file from the server.
 * This function interacts with the `/load-config` endpoint on the server,
 * which is designed to serve static configuration files.
 *
 * @async
 * @param {string} filename - The name of the configuration file to load (e.g., 'rssFeeds.txt', 'config.json').
 * @returns {Promise<object>} A promise that resolves to the JSON response from the server.
 * The response is expected to contain a 'content' field with the file's data.
 * @throws {Error} If the network request fails or the server returns an error status.
 */
export async function loadConfigFile(filename) {
    const response = await fetch(`/load-config?filename=${filename}`);
    if (!response.ok) {
        throw new Error(`Failed to load configuration file '${filename}': ${response.status} ${response.statusText}`);
    }
    return response.json();
}

/**
 * Saves content to a specified configuration file on the server.
 * This function interacts with the `/save-config` endpoint on the server,
 * allowing the client to update server-side configuration files.
 *
 * @async
 * @param {string} filename - The name of the configuration file to save (e.g., 'rssFeeds.txt', 'config.json').
 * @param {string} content - The string content to be written to the file.
 * @returns {Promise<object>} A promise that resolves to the JSON response from the server,
 * typically indicating success (e.g., `{status: "ok"}`).
 * @throws {Error} If the network request fails or the server returns an error status.
 */
export async function saveConfigFile(filename, content) {
    const response = await fetch(`/save-config?filename=${filename}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });
    if (!response.ok) {
        throw new Error(`Failed to save configuration file '${filename}': ${response.status} ${response.statusText}`);
    }
    return response.json();
}