import { dbPromise, saveStateValue, loadArrayState, saveArrayState, pendingOperations, isOnline, loadStateValue } from '../data/database.js';

export async function toggleStar(app, guid) {
    const db = await dbPromise;
    const items = await loadArrayState(db, 'starred');
    const idx = items.findIndex(e => e.id === guid);
    const action = idx === -1 ? "add" : "remove";
    const starredAt = idx === -1 ? new Date().toISOString() : undefined;

    if (idx === -1) {
        items.push({ id: guid, starredAt });
    } else {
        items.splice(idx, 1);
    }
    app.starred = items; // Update app state reference
    await saveArrayState(db, 'starred', items);

    if (typeof app.updateCounts === 'function') app.updateCounts();

    const delta = { id: guid, action, starredAt };
    if (!isOnline()) {
        pendingOperations.push({ type: 'starDelta', data: delta });
    } else {
        try {
            await fetch("/user-state/starred/delta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(delta)
            });
        } catch (err) {
            console.error("Failed to sync star change:", err);
            pendingOperations.push({ type: 'starDelta', data: delta });
        }
    }
}

export async function toggleHidden(app, guid) {
    const db = await dbPromise;
    const items = await loadArrayState(db, 'hidden');
    const idx = items.findIndex(e => e.id === guid);
    const action = idx === -1 ? "add" : "remove";
    const hiddenAt = idx === -1 ? new Date().toISOString() : undefined;

    if (idx === -1) {
        items.push({ id: guid, hiddenAt });
    } else {
        items.splice(idx, 1);
    }
    app.hidden = items; // Update app state reference
    await saveArrayState(db, 'hidden', items);

    if (typeof app.updateCounts === 'function') app.updateCounts();

    const delta = { id: guid, action, hiddenAt };
    if (!isOnline()) {
        pendingOperations.push({ type: 'hiddenDelta', data: delta });
    } else {
        try {
            await fetch("/user-state/hidden/delta", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(delta)
            });
        } catch (err) {
            console.error("Failed to sync hidden change:", err);
            pendingOperations.push({ type: 'hiddenDelta', data: delta });
        }
    }
}

export async function pruneStaleHidden(db, feedItems, currentTS) {
    let hidden = await loadArrayState(db, 'hidden');

    if (!Array.isArray(hidden)) hidden = [];
    if (!Array.isArray(feedItems) || feedItems.length === 0 || !feedItems.every(e => e && typeof e.id === 'string')) return hidden;

    const validFeedIds = new Set(feedItems.map(e => e.id.trim().toLowerCase()));
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const pruned = hidden.filter(i => {
        const normalizedId = String(i.id).trim().toLowerCase();
        if (validFeedIds.has(normalizedId)) return true;
        const hiddenAtTS = new Date(i.hiddenAt).getTime();
        return (currentTS - hiddenAtTS) < THIRTY_DAYS_MS;
    });

    if (pruned.length < hidden.length) {
        await saveArrayState(db, 'hidden', pruned);
    }
    return pruned;
}

export async function loadCurrentDeck(db) {
    let guids = await loadArrayState(db, 'currentDeck');
    return Array.isArray(guids) ? guids : [];
}

export async function saveCurrentDeck(db, guids) {
    await saveArrayState(db, 'currentDeck', guids);
}

export async function loadShuffleState(db) {
    const count = await loadStateValue(db, 'shuffleCount', 2);
    const dateStr = await loadStateValue(db, 'lastShuffleResetDate', null);
    let lastResetDate = null;
    if (dateStr) {
        try { lastResetDate = new Date(dateStr); } catch (err) { console.warn("Invalid lastShuffleResetDate:", dateStr, err); }
    }
    return { shuffleCount: count, lastShuffleResetDate: lastResetDate };
}

export async function saveShuffleState(db, count, resetDate) {
    await saveStateValue(db, 'shuffleCount', count);
    await saveStateValue(db, 'lastShuffleResetDate', resetDate.toISOString());
}

export async function setFilterMode(app, db, mode) {
    app.filterMode = mode;
    await saveStateValue(db, 'filterMode', mode);
}

export async function loadFilterMode(db) {
    return await loadStateValue(db, 'filterMode', 'unread');
}