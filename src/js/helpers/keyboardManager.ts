import { AppState } from '@/types/app.ts';

/**
 * Handles keyboard events for application navigation and actions.
 * @param {KeyboardEvent} event The keyboard event object.
 * @param {AppState} app The application state object.
 */
export async function handleKeyboardShortcuts(event: KeyboardEvent, app: AppState): Promise<void> {
    // 1. Check if we should ignore the shortcut (e.g., user is typing in an input)
    const target = event.target as HTMLElement;
    const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    
    if (isTyping) return;

    // 2. Define action keys
    const key = event.key;
    const isCtrlOrCmd = event.ctrlKey || event.metaKey;

    // 3. Handle shortcuts
    switch (key) {
        case 'j':
        case 'ArrowDown':
            event.preventDefault();
            await moveSelection(app, 1);
            break;

        case 'k':
            if (isCtrlOrCmd) {
                event.preventDefault();
                if (app.openShortcuts) {
                    app.openShortcuts = false;
                } else {
                    app.openShortcuts = true;
                }
            }
            else {
                event.preventDefault();
                await moveSelection(app, -1);
            }
            break;

        case 'ArrowUp':
            event.preventDefault();
            await moveSelection(app, -1);
            break;

        case ' ':
        case 'n':
            event.preventDefault();
            if (app.selectedGuid) {
                const currentGuid = app.selectedGuid;
                // Move selection FIRST before it's removed from the unread list
                await moveSelection(app, 1);
                await app.toggleRead(currentGuid);
            } else if (app.filteredEntries.length > 0) {
                app.selectedGuid = app.filteredEntries[0].guid;
                scrollSelectedIntoView(app.selectedGuid, app);
            }
            break;

        case 's':
        case 'L':
            if (app.selectedGuid) {
                event.preventDefault();
                await app.toggleStar(app.selectedGuid);
            }
            break;

        case 'i':
            event.preventDefault();
            app.imagesEnabled = !app.imagesEnabled;
            // Persist the change
            import('../data/database.ts').then(m => {
                m.saveSimpleState('imagesEnabled', app.imagesEnabled);
            });
            break;

        case 'o':
        case 'Enter':
            if (app.selectedGuid) {
                event.preventDefault();
                const item = app.filteredEntries.find(e => e.guid === app.selectedGuid);
                if (item?.link) {
                    window.open(item.link, '_blank', 'noopener,noreferrer');
                }
            }
            break;

        case 'r':
            if (app.selectedGuid) {
                event.preventDefault();
                await app.toggleRead(app.selectedGuid);
            }
            break;

        case 'u':
            event.preventDefault();
            if (app.filterMode !== 'unread') {
                app.filterMode = 'unread';
            }
            app.scrollToTop();
            app.selectedGuid = null;
            break;

        case '?':
            event.preventDefault();
            if (app.openShortcuts) {
                app.openShortcuts = false;
            } else {
                app.openShortcuts = true;
            }
            break;

        case 'Escape':
            if (app.openShortcuts) {
                event.preventDefault();
                app.openShortcuts = false;
            } else if (app.openSettings) {
                event.preventDefault();
                app.openSettings = false;
            }
            break;

        case 'z':
            if (isCtrlOrCmd) {
                event.preventDefault();
                await app.undoMarkRead();
            }
            break;
    }
}

/**
 * Moves the current selection up or down.
 * @param {AppState} app The application state.
 * @param {number} direction 1 for next, -1 for previous.
 */
async function moveSelection(app: AppState, direction: number): Promise<void> {
    const entries = app.filteredEntries;
    if (entries.length === 0) return;

    if (!app.selectedGuid) {
        app.selectedGuid = entries[0].guid;
    } else {
        const currentIndex = entries.findIndex(e => e.guid === app.selectedGuid);
        let nextIndex = currentIndex + direction;

        if (nextIndex >= entries.length) nextIndex = entries.length - 1;
        if (nextIndex < 0) nextIndex = 0;

        app.selectedGuid = entries[nextIndex].guid;
    }

    scrollSelectedIntoView(app.selectedGuid, app);
}

/**
 * Scrolls the selected item to the top of the viewport with an offset for the header.
 * @param {string} guid The GUID of the item to scroll to.
 * @param {AppState} app The application state.
 */
export function scrollSelectedIntoView(guid: string | null, app: AppState): void {
    if (!guid) return;
    
    // Check if it's the first item
    if (app.filteredEntries.length > 0 && app.filteredEntries[0].guid === guid) {
        app.scrollToTop();
        return;
    }

    // We use a small timeout to ensure Alpine has updated the DOM
    setTimeout(() => {
        const element = document.querySelector(`.entry[data-guid="${guid}"]`) as HTMLElement;
        if (element) {
            const header = document.querySelector('#header');
            const headerHeight = header ? header.getBoundingClientRect().height : 0;
            const elementPosition = element.getBoundingClientRect().top + window.pageYOffset;
            const offsetPosition = elementPosition - headerHeight - 20; // 20px extra padding

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    }, 10);
}
