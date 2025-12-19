# Patch 4: Call _initObservers in initApp

This patch adds a call to the `_initObservers` function within the `initApp` function. This ensures that the stale item observer is initialized and the feature is active.

## Instructions

In `src/main.ts`, inside the `initApp` function of the `rssApp` object, find the following block of code:

```typescript
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._startPeriodicSync();
                this._initScrollObserver();
```

And replace it with this:

```typescript
                this.progressMessage = 'Setting up app watchers...';
                this._setupWatchers();
                this._setupEventListeners();
                this._startPeriodicSync();
                this._initScrollObserver();
                this._initObservers();
```
