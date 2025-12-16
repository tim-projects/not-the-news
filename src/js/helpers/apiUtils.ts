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
 * (like starred/read items or deck GUIDs) which are managed through separate,
 * potentially more granular, user-state specific API endpoints.
 *
 * Note: This file currently uses standard `fetch` for network requests.
 * If a global `fetchWithRetry` utility from `database.js` (or similar) is intended
 * to centralize API call robustness, these functions should be updated to utilize it.
 */

/**
 * Handles the response from a fetch request, checking for errors and parsing JSON.
 * @private
 * @param {Response} response - The Response object from the fetch call.
 * @param {string} filename - The name of the file being processed, for error logging.
 * @returns {Promise<any>} A promise that resolves with the parsed JSON data.
 * @throws {Error} If the response status is not 'ok'.
 */
const handleResponse = async (response: Response, filename: string): Promise<any> => {
    if (!response.ok) {
        throw new Error(`Failed to process configuration file '${filename}': ${response.status} ${response.statusText}`);
    }
    return response.json();
};

/**
 * Builds a URL for the config API endpoints.
 * @private
 * @param {string} endpoint - The API endpoint (e.g., 'load-config').
 * @param {string} filename - The name of the configuration file.
 * @returns {URL} A URL object with the filename properly encoded.
 */
const buildConfigUrl = (endpoint: string, filename: string): URL => {
    const url = new URL(`/${endpoint}`, window.location.origin);
    url.searchParams.append('filename', filename);
    return url;
};

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
export const loadConfigFile = async (filename: string): Promise<object> => {
    const response = await fetch(buildConfigUrl('load-config', filename));
    return handleResponse(response, filename);
};

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
export const saveConfigFile = async (filename: string, content: string): Promise<object> => {
    const response = await fetch(buildConfigUrl('save-config', filename), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });
    return handleResponse(response, filename);
};

/**
 * Loads a specific user state key from the server.
 * @async
 * @param {string} key - The user state key to load (e.g., 'rssFeeds', 'keywordBlacklist').
 * @returns {Promise<object>} A promise that resolves to the user state data.
 * @throws {Error} If the network request fails or the server returns an error status.
 */
export const loadUserState = async (key: string): Promise<object> => {
    const response = await fetch(`/api/user-state/${key}`);
    if (!response.ok) {
        throw new Error(`Failed to load user state for key '${key}': ${response.status} ${response.statusText}`);
    }
    return response.json();
};

/**
 * Saves a simple user state key-value pair to the server.
 * @async
 * @param {string} key - The user state key to save.
 * @param {any} value - The value to save for the given key.
 * @returns {Promise<object>} A promise that resolves to the server's response.
 * @throws {Error} If the network request fails or the server returns an error status.
 */
export const saveUserState = async (key: string, value: any): Promise<object> => {
    const response = await fetch('/api/user-state', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ type: "simpleUpdate", key: key, value: value }]),
    });
    if (!response.ok) {
        throw new Error(`Failed to save user state for key '${key}': ${response.status} ${response.statusText}`);
    }
    return response.json();
};
