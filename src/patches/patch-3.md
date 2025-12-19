# Patch 3: Restore _initObservers function in src/main.ts

This patch restores the implementation of the `_initObservers` function from the original `src/main.ts` into the newly merged `rssApp` function. This is to ensure that the feature of removing stale items from the deck is not lost.

## Instructions

In `src/main.ts`, inside the `rssApp` function, find the following placeholder for the `_initObservers` function:

```typescript
        _initObservers: function(this: AppState): void {
            // This method will be responsible for initializing any observers
            // that need access to the AppState (e.g., IntersectionObserver for stale items).
            // Currently, _initScrollObserver handles the main deck scrolling.
            // This placeholder is for future extensions, e.g., to manage item staleness.
            console.log("Initializing additional observers (placeholder)...");
        },
```

And replace it with this implementation:

```typescript
        _initObservers: function(this: AppState): void {
            this.staleItemObserver = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
                entries.forEach((entry: IntersectionObserverEntry) => {
                    if (!entry.isIntersecting) {
                        const guid = (entry.target as HTMLElement).dataset.guid; // Cast to HTMLElement to access dataset
                        console.log(`[Observer] Stale item ${guid} is off-screen. Removing.`);
                        this.deck = this.deck.filter(item => item.guid !== guid);
                        this.staleItemObserver?.unobserve(entry.target); // Use optional chaining
                    }
                });
            }, { root: null, threshold: 0 });
        },
```
