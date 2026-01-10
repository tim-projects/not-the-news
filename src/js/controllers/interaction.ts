import { AppState } from '@/types/app.ts';
import { toggleItemStateAndSync, saveCurrentDeck } from '../helpers/userStateUtils.ts';
import { updateCounts, createStatusBarMessage, showUndoNotification } from '../ui/uiUpdaters.ts';
import { scrollSelectedIntoView } from '../helpers/keyboardManager.ts';
import { speakItem as ttsSpeak, stopSpeech } from '../helpers/ttsManager.ts';
import { manageDailyDeck } from '../helpers/deckManager.ts';
import { loadAndDisplayDeck } from './deck.ts';
import { observeImage } from '../ui/observers.ts';

export async function toggleRead(app: AppState, guid: string): Promise<void> {
    // Stop TTS if it's playing for the item being marked read (UX improvement)
    if (app.speakingGuid === guid) {
        stopSpeech(app);
    }

    const isCurrentlyRead = app.isRead(guid);
    const wasSelected = app.selectedGuid === guid;
    let nextGuidToSelect: string | null = null;

    // Identify next item BEFORE we change the read status, if it's currently selected in unread mode
    if (!isCurrentlyRead && wasSelected && app.filterMode === 'unread') {
        const entries = app.filteredEntries;
        const currentIndex = entries.findIndex(e => e.guid === guid);
        if (currentIndex !== -1) {
            if (currentIndex < entries.length - 1) {
                nextGuidToSelect = entries[currentIndex + 1].guid;
            } else if (currentIndex > 0) {
                nextGuidToSelect = entries[currentIndex - 1].guid;
            }
        }
    }
    
    if (!isCurrentlyRead) {
        app.readingGuid = guid;
        const animFactor = 100 / (app.animationSpeed || 100);
        // Phase 1: Fold animation (333ms baseline)
        if (app.filterMode === 'unread') {
            app.closingGuid = guid;
            await new Promise(resolve => setTimeout(resolve, 333 * animFactor));
            
            // Select next item AFTER fold but DURING swipe for smoother feel
            if (nextGuidToSelect) {
                selectItem(app, nextGuidToSelect);
            }

            // Phase 2: Swipe animation (300ms baseline)
            await new Promise(resolve => setTimeout(resolve, 300 * animFactor));
        } else {
            // Just the short delay for the button animation if not removing
            await new Promise(resolve => setTimeout(resolve, 333 * animFactor));
        }
        
        // Small buffer to ensure browser has rendered the final frames of CSS animations
        await new Promise(resolve => setTimeout(resolve, 50));
        
        app.readingGuid = null;
        app.closingGuid = null;
    }

    if (app.isDemo) {
        app.deck = app.deck.filter(item => item.guid !== guid);
        return;
    }

    let removedIndex: number | null = null;
    
    // --- IMMEDIATE STATE UPDATE ---
    // Directly update the item's read status in the current deck and entries
    app.deck = app.deck.map(item =>
        item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
    );
    app.entries = app.entries.map(item =>
        item.guid === guid ? { ...item, isRead: !isCurrentlyRead } : item
    );

    if (!isCurrentlyRead) {
        app.nextSwipeDirection = app.nextSwipeDirection === 'left' ? 'right' : 'left';
    }

    if (app.filterMode === 'unread' && !isCurrentlyRead) {
        // If it was unread and now read, remove it from the deck in unread mode
        removedIndex = app.currentDeckGuids.findIndex(item => item.guid === guid);
        if (removedIndex === -1) removedIndex = null;

        app.deck = app.deck.filter(item => item.guid !== guid);
        app.currentDeckGuids = app.currentDeckGuids.filter(deckItem => deckItem.guid !== guid);
        
        // Selection cleanup
        if (!nextGuidToSelect && wasSelected) {
            app.selectedGuid = null;
        }
    } else if (app.filterMode === 'unread' && isCurrentlyRead) {
        // If it was read and now unread (Undo), add it back to the deck if missing
        if (!app.currentDeckGuids.some(deckItem => deckItem.guid === guid)) {
            const deckItem = { guid, addedAt: new Date().toISOString() };
            if (app.undoItemIndex !== null && app.undoItemIndex >= 0) {
                app.currentDeckGuids.splice(app.undoItemIndex, 0, deckItem);
            } else {
                app.currentDeckGuids.push(deckItem);
            }
        }
    }
    
    updateCounts(app);
    if (app.updateSyncStatusMessage) app.updateSyncStatusMessage();

    if (!isCurrentlyRead && app.filterMode !== 'all') {
        showUndoNotification(app, guid, removedIndex);
    }

    // --- BACKGROUND WORK: Move DB and Sync actions to background to keep UI snappy ---
    (async () => {
        // 1. Sync and array updates (Awaited but inside background scope)
        await toggleItemStateAndSync(app, guid, 'read');

        // 2. Save current deck state
        await saveCurrentDeck(app.currentDeckGuids, app);

        // 3. UI Reconcile (minor cleanup)
        if (app._reconcileAndRefreshUI) await app._reconcileAndRefreshUI();

        // 4. Refresh logic: ONLY when deck is completely finished (0 unread)
        let remainingUnreadInDeck = app.deck.filter(item => !app.isRead(item.guid)).length;
        
        if (app.filterMode === 'unread' && remainingUnreadInDeck === 0) {
            console.log("[toggleRead] Current deck finished. Preparing next batch in background...");
            
            // Trigger background tasks while user sees the undo button
            if (app.pregenerateDecks) app.pregenerateDecks();
            if (app.loadFeedItemsFromDB) app.loadFeedItemsFromDB();
            
            // Assuming _loadAndManageAllData is available on app or imported
            // We need to cast app to any or ensure the method exists in AppState
            if ((app as any)._loadAndManageAllData) {
                 const refreshPromise = (app as any)._loadAndManageAllData(true); // skipLoad: true

                // Wait while undo is visible (max 5.5s) without blocking the UI
                while (app.showUndo) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                // Once undo is gone, wait for the already-started refresh to finish
                await refreshPromise;

                // Re-verify after potential undo
                remainingUnreadInDeck = app.deck.filter(item => !app.isRead(item.guid)).length;
                if (remainingUnreadInDeck > 0) {
                    console.log("[toggleRead] Undo detected, batch preserved.");
                    return;
                }

                // Auto-select first item of the new batch
                if (app.deck.length > 0) {
                    selectItem(app, app.deck[0].guid);
                }
            }
        }
    })();
}

export async function toggleStar(app: AppState, guid: string): Promise<void> {
    if (app.isDemo) {
        app.deck = app.deck.map(item => item.guid === guid ? { ...item, isStarred: !item.isStarred } : item);
        app.showCta = true;
        return;
    }
    const isStarring = !app.starred.some(item => item.guid === guid);
    if (isStarring) {
        app.starredGuid = guid;
        const animDuration = 667 * (100 / (app.animationSpeed || 100));
        setTimeout(() => {
            if (app.starredGuid === guid) app.starredGuid = null;
        }, animDuration); // Sync with CSS draw-outline duration + delay
    }

    // --- IMMEDIATE STATE UPDATE ---
    app.deck = app.deck.map(item =>
        item.guid === guid ? { ...item, isStarred: isStarring } : item
    );
    app.entries = app.entries.map(item =>
        item.guid === guid ? { ...item, isStarred: isStarring } : item
    );

    await toggleItemStateAndSync(app, guid, 'starred');
}

export async function undoMarkRead(app: AppState): Promise<void> {
    if (app.undoStack.length === 0) {
        app.showUndo = false;
        return;
    }
    
    const lastAction = app.undoStack.pop();
    if (!lastAction) return;

    const guid = lastAction.guid;
    // Temporarily set these for any logic that depends on single-item undo state
    app.undoItemGuid = guid;
    app.undoItemIndex = lastAction.index;

    // If we've popped the last item, hide the notification
    if (app.undoStack.length === 0) {
        app.showUndo = false;
    }

    await toggleRead(app, guid);
    
    // Clear temp state
    app.undoItemGuid = null;
    app.undoItemIndex = null;
}

export function selectItem(app: AppState, guid: string): void {
    if (app.selectedGuid === guid) {
        // Even if already selected, clicking should close shortcuts if they are open
        if (app.openShortcuts) app.openShortcuts = false;
        return;
    }
    app.selectedGuid = guid;
    if (app.openShortcuts) app.openShortcuts = false;
    // Use the same scroll logic as keyboard manager
    scrollSelectedIntoView(guid, app);
}

export function handleEntryLinks(app: AppState, element: Element): void {
    if (element) {
        element.querySelectorAll('a').forEach(link => {
            if (link.hostname !== window.location.hostname) {
                if (app.openUrlsInNewTabEnabled) {
                    link.setAttribute('target', '_blank');
                    link.setAttribute('rel', 'noopener noreferrer');
                } else {
                    link.removeAttribute('target');
                }
            }
            link.addEventListener('click', (e) => {
                const item = (e.target as HTMLElement).closest('.item');
                if (!item) return;
                const guid = (item as HTMLElement).dataset.guid;
                
                if (!guid || app.selectedGuid === guid) return; // Allow normal click if selected

                // Check "coverage" - if item is mostly off screen, select it instead of following link
                const rect = item.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                
                // Visible height ratio
                const visibleHeight = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
                const itemHeight = rect.height;
                // If item is very tall, use viewport height as denominator
                const denominator = Math.min(itemHeight, viewportHeight);
                const ratio = Math.max(0, visibleHeight) / denominator;

                console.log(`[LinkClick] Item coverage: ${(ratio * 100).toFixed(1)}%`);

                // Threshold: if less than 90% visible (or covers 90% of viewport), select first
                if (ratio > 0.9) {
                    app.selectedGuid = guid;
                    console.log(`[LinkClick] High coverage, updating selection but allowing click.`);
                } else {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log(`[LinkClick] Low coverage, selecting item first.`);
                    selectItem(app, guid);
                }
            });
        });
    }
}

export function handleEntryImages(app: AppState, element: Element): void {
    if (!element) return;
    // Find all images in this element (e.g. in the description HTML)
    element.querySelectorAll('img').forEach(img => {
        observeImage(app, img as HTMLImageElement);
    });
}

export function toggleItemMenu(app: AppState, guid: string): void {
    if (app.activeMenuGuid === guid) {
        app.activeMenuGuid = null;
    } else {
        app.activeMenuGuid = guid;
    }
}

export function shareItem(app: AppState, guid: string): void {
    const entry = app.entries.find(e => e.guid === guid);
    if (!entry) return;
    
    console.log(`[Share] Sharing item: ${entry.title}`);
    createStatusBarMessage(app, 'Sharing feature coming soon!');
    
    // Close menu after action
    app.activeMenuGuid = null;
}

export function speakItem(app: AppState, guid: string): void {
    ttsSpeak(app, guid);
}
