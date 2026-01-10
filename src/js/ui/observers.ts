import { AppState } from '@/types/app.ts';

export function observeImage(app: AppState, el: HTMLImageElement): void {
    // Native loading="lazy" handles the timing. 
    // We just ensure the fade-in class is applied when the browser finishes loading.
    if (el.complete) {
        el.classList.add('loaded');
    } else {
        el.addEventListener('load', () => el.classList.add('loaded'), { once: true });
    }
}

export function _initImageObserver(app: AppState): void {
    // Manual observer no longer needed for swapping src, 
    // but we keep the method signature for compatibility.
    app.imageObserver = null;
}

export function _initScrollObserver(app: AppState): void {
    app.scrollObserver = new IntersectionObserver(async (entries) => {
        // Scroll observer logic can be added here if needed in future
    }, {
        root: document.querySelector('#feed-container'),
        rootMargin: '0px',
        threshold: 0.1
    });

    // Re-attach if DOM changes (Alpine might re-render the list)
    const container = document.querySelector('#feed-container');
    if (!container) return;

    const attach = () => {
        container.querySelectorAll('[data-guid]').forEach(el => {
            app.scrollObserver?.observe(el);
        });
    };

    attach();

    new MutationObserver(() => {
        app.scrollObserver?.disconnect();
        attach();
    }).observe(container, { childList: true, subtree: true });
}

export function _initObservers(app: AppState): void {
    app.staleItemObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
        entries.forEach((entry: IntersectionObserverEntry) => {
            if (!entry.isIntersecting) {
                const guid = (entry.target as HTMLElement).dataset.guid; // Cast to HTMLElement to access dataset
                console.log(`[Observer] Stale item ${guid} is off-screen. Removing.`);
                app.deck = app.deck.filter(item => item.guid !== guid);
                app.staleItemObserver?.unobserve(entry.target); // Use optional chaining
            }
        });
    }, { root: null, threshold: 0 });
}
