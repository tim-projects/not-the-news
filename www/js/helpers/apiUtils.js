// This file assumes fetchWithRetry is imported from database.js if it's not a global utility
// For this structure, fetchWithRetry is a core DB utility for API calls.

export async function loadConfigFile(filename) {
    const response = await fetch(`/load-config?filename=${filename}`);
    if (!response.ok) throw new Error(`Failed to load ${filename}`);
    return response.json();
}

export async function saveConfigFile(filename, content) {
    const response = await fetch(`/save-config?filename=${filename}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });
    if (!response.ok) throw new Error(`Failed to save ${filename}`);
    return response.json();
}