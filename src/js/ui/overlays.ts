import { AppState } from '@/types/app.ts';
import { loadAndDisplayDeck } from '../controllers/deck.ts';
import { updateCounts } from './uiUpdaters.ts';
import { toggleSearch as searchManagerToggle } from '../helpers/searchManager.ts';

export function toggleSearch(app: AppState): void {
    searchManagerToggle(app);
}

export function updateAllUI(app: AppState): void {
    updateCounts(app);
}

export async function _reconcileAndRefreshUI(app: AppState): Promise<void> {
    if (app.isDemo) return;
    console.log('[UI] _reconcileAndRefreshUI: Initiating UI reconciliation and refresh.');
    // This function is intended to be called when the underlying data (read, starred, etc.) changes
    // and the UI needs to be updated to reflect those changes without a full deck reload.
    // For now, we'll re-run loadAndDisplayDeck and updateAllUI, but this could be optimized
    // in the future to only update changed items.
    await loadAndDisplayDeck(app);
    updateAllUI(app);
    console.log('[UI] _reconcileAndRefreshUI: Completed UI reconciliation and refresh.');
}
