import { AppState } from '@/types/app.ts';
import { createStatusBarMessage } from '../ui/uiUpdaters.ts';

const SELECTION_FADE_DURATION = 10000; // 10 seconds

/**
 * Handles vertical navigation (j/k, Up/Down).
 * If the current item has been selected for more than 10 seconds,
 * the first press will reselect it instead of moving.
 */
export async function handleVerticalNavigation(app: AppState, direction: number): Promise<void> {
    const now = Date.now();
    const isSelectionOld = app.selectedGuid && app.selectedTimestamp && (now - app.selectedTimestamp > SELECTION_FADE_DURATION);

    if (isSelectionOld) {
        console.log('[Navigation] Selection is old (>10s). Reselecting current item.');
        const currentGuid = app.selectedGuid;
        // Temporarily clear to re-trigger watcher/animation
        app.selectedGuid = null;
        app.$nextTick(() => {
            app.selectedGuid = currentGuid;
        });
    } else {
        // Signal that we are scrolling via keyboard to suppress scroll-to-top button
        const { setKeyboardScrolling } = await import('../ui/uiUpdaters.ts');
        setKeyboardScrolling(true);
        
        await moveSelection(app, direction);
        
        // Reset after a delay to allow the scroll event to complete (increased to 1000ms)
        setTimeout(() => setKeyboardScrolling(false), 1000);
    }
}

/**
 * Handles global keyboard shortcuts.
 * @param {KeyboardEvent} event The keyboard event.
 * @param {AppState} app The main application object.
 */
export async function handleKeyboardShortcuts(event: KeyboardEvent, app: AppState): Promise<void> {
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
    }

    const key = event.key;
    const ctrlOrMeta = event.ctrlKey || event.metaKey;

    // --- Settings Modal Navigation ---
    if (app.openSettings) {
        // Block global navigation while settings is open
        const isNavigationKey = ['j', 'k', 's', 'L', 'i', 'o', 'Enter', 'r', 'm', 't', 'u', 'p', ' ', 'ArrowUp', 'ArrowDown'].includes(key);
        
        if (isNavigationKey && !ctrlOrMeta) {
            // Allow Enter if it's on a button or select or link
            const allowedTags = ['BUTTON', 'SELECT', 'A', 'INPUT', 'TEXTAREA'];
            if (key === 'Enter' && allowedTags.includes(target.tagName)) {
                // Let default handle it if it's an input or textarea, or button
                return;
            }
            event.preventDefault();
        }

        const modal = document.querySelector('.modal-content');
        if (!modal) {
             // Fallback if modal DOM is missing but state is open
             if (key === 'Escape') {
                event.preventDefault();
                app.openSettings = false;
             }
             return;
        }

        const selectors = 'button, select, input, textarea, [tabindex]:not([tabindex="-1"])';
        const focusableElements = Array.from(modal.querySelectorAll(selectors))
            .filter(el => {
                const style = window.getComputedStyle(el);
                return style.display !== 'none' && style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null;
            }) as HTMLElement[];

        // Allow Escape to close even if no focusable elements
        if (key === 'Escape') {
            event.preventDefault();
            app.openSettings = false;
            return;
        }

        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];
        const index = focusableElements.indexOf(document.activeElement as HTMLElement);

        // Trap Tab
        if (key === 'Tab') {
            if (event.shiftKey) {
                if (document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                }
            }
            else {
                if (document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }

        // Arrow Key Selection within Settings
        if (key === 'ArrowDown' || (key === 'j' && !ctrlOrMeta)) {
            event.preventDefault();
            const nextIndex = (index + 1) % focusableElements.length;
            focusableElements[nextIndex].focus();
        }

        if (key === 'ArrowUp' || (key === 'k' && !ctrlOrMeta)) {
            event.preventDefault();
            const prevIndex = (index - 1 + focusableElements.length) % focusableElements.length;
            focusableElements[prevIndex].focus();
        }

        // Slider (Range) Navigation
        if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'range') {
            if (key === 'ArrowLeft' || key === 'ArrowRight' || (key === 'h' && !ctrlOrMeta) || (key === 'l' && !ctrlOrMeta)) {
                event.preventDefault();
                const step = parseFloat((target as HTMLInputElement).step) || 1;
                const currentValue = parseFloat((target as HTMLInputElement).value);
                const isRight = key === 'ArrowRight' || key === 'l';
                const newValue = isRight ? currentValue + step : currentValue - step;
                
                (target as HTMLInputElement).value = newValue.toString();
                // Manually trigger events so Alpine.js sees the change
                target.dispatchEvent(new Event('input', { bubbles: true }));
                target.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }

        // Enter key as Click
        if (key === 'Enter') {
            // Standard buttons already handle Enter, but we ensure it works for all focused sub-elements
            if (target.tagName !== 'SELECT') { // Don't click selects, as Enter might be used to confirm choice
                event.preventDefault();
                target.click();
            }
        }

        return;
    }

    // Block most shortcuts if the shortcuts panel is open (except toggle/close)
    if (app.openShortcuts && key !== '?' && key !== 'Escape' && !(key === 'k' && ctrlOrMeta)) {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'j', 'k'].includes(key)) {
            event.preventDefault();
        }
        return;
    }

    // Skip custom navigation if Shift is held (allows normal browser scrolling)
    if (event.shiftKey && ['j', 'k', 'ArrowDown', 'ArrowUp'].includes(key)) {
        return;
    }

    switch (key) {
        case 'j':
        case 'ArrowDown':
            event.preventDefault();
            await handleVerticalNavigation(app, 1);
            break;

        case 'k':
            if (ctrlOrMeta) {
                event.preventDefault();
                app.openShortcuts = !app.openShortcuts;
            } else {
                event.preventDefault();
                await handleVerticalNavigation(app, -1);
            }
            break;

        case 'ArrowUp':
            event.preventDefault();
            await handleVerticalNavigation(app, -1);
            break;

        case 'l':
        case 'ArrowRight':
            if (app.selectedGuid) {
                event.preventDefault();
                if (app.selectedSubElement === 'item') {
                    app.selectedSubElement = 'read';
                } else if (app.selectedSubElement === 'read') {
                    app.selectedSubElement = 'star';
                } else if (app.selectedSubElement === 'star') {
                    app.selectedSubElement = 'play';
                }
            }
            break;

        case 'h':
        case 'ArrowLeft':
            if (app.selectedGuid) {
                event.preventDefault();
                if (app.selectedSubElement === 'play') {
                    app.selectedSubElement = 'star';
                } else if (app.selectedSubElement === 'star') {
                    app.selectedSubElement = 'read';
                } else if (app.selectedSubElement === 'read') {
                    app.selectedSubElement = 'item';
                }
            }
            break;

        case 'p':
            if (app.selectedGuid) {
                event.preventDefault();
                app.speakItem(app.selectedGuid);
            }
            break;

        case ' ':
        case 'n':
            event.preventDefault();
            if (app.selectedGuid) {
                // Main toggleRead logic will now handle selecting the next item
                await app.toggleRead(app.selectedGuid);
            } else if (app.filteredEntries.length > 0) {
                // If nothing is selected, select the first unread item
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
            createStatusBarMessage(app, `Images ${app.imagesEnabled ? 'Enabled' : 'Disabled'}.`);
            // Persist the change
            import('../data/database.ts').then(m => {
                m.saveSimpleState('imagesEnabled', app.imagesEnabled);
            });
            break;

        case 'o':
        case 'Enter':
            if (app.selectedGuid) {
                event.preventDefault();
                if (app.selectedSubElement === 'read') {
                    await app.toggleRead(app.selectedGuid);
                } else if (app.selectedSubElement === 'star') {
                    await app.toggleStar(app.selectedGuid);
                } else if (app.selectedSubElement === 'play') {
                    app.speakItem(app.selectedGuid);
                } else {
                    const item = app.filteredEntries.find(e => e.guid === app.selectedGuid);
                    if (item?.link) {
                        window.open(item.link, '_blank', 'noopener,noreferrer');
                    }
                }
            }
            break;

        case 'r':
        case 'm':
            if (app.selectedGuid) {
                event.preventDefault();
                await app.toggleRead(app.selectedGuid);
            }
            break;

        case 't':
            event.preventDefault();
            app.scrollToTop();
            break;

        case 'u':
            event.preventDefault();
            await app.undoMarkRead();
            break;

        case '/':
            event.preventDefault();
            app.toggleSearch();
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
            } else if (app.selectedGuid) {
                event.preventDefault();
                app.selectedGuid = null;
            }
            break;

        case 'z':
            if (ctrlOrMeta) {
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
        // If nothing is selected, try to start from lastSelectedGuid
        const baseGuid = app.lastSelectedGuid;
        const currentIndex = baseGuid ? entries.findIndex(e => e.guid === baseGuid) : -1;
        
        if (currentIndex === -1) {
            // If lastSelectedGuid is not in current view or doesn't exist, start at top
            app.selectedGuid = entries[0].guid;
        } else {
            // Navigate relative to lastSelectedGuid
            let nextIndex = currentIndex + direction;
            if (nextIndex >= entries.length) nextIndex = entries.length - 1;
            if (nextIndex < 0) nextIndex = 0;
            app.selectedGuid = entries[nextIndex].guid;
        }
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