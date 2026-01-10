# Refactor Task: Create `src/js/controllers/interaction.ts`

## Context
Extracting user interaction logic (reading, starring, selecting).

## Source File
- `src/main.ts`

## Target File
- `src/js/controllers/interaction.ts`

## Instructions
1.  **Read `src/main.ts`** to locate:
    - `toggleRead`
    - `toggleStar`
    - `undoMarkRead`
    - `selectItem`
    - `handleEntryLinks`
    - `handleEntryImages` (if closely tied to entry rendering)
    - `toggleItemMenu`
    - `shareItem`
    - `speakItem`

2.  **Create `src/js/controllers/interaction.ts`**.

3.  **Add Imports**:
    - `import { AppState } from '@/types/app.ts';`
    - `import { toggleItemStateAndSync } from '../helpers/userStateUtils.ts';`
    - `import { saveCurrentDeck } from '../helpers/userStateUtils.ts';`
    - `import { updateCounts, createStatusBarMessage, showUndoNotification } from '../ui/uiUpdaters.ts';`
    - `import { scrollSelectedIntoView } from '../helpers/keyboardManager.ts';`
    - `import { speakItem as ttsSpeak, stopSpeech } from '../helpers/ttsManager.ts';`
    - `import { manageDailyDeck } from '../helpers/deckManager.ts';`
    - `import { loadAndDisplayDeck } from './deck.ts';` (Circular dependency risk here. If deck.ts imports interaction.ts, be careful. Maybe keep loadAndDisplayDeck in main or a separate view controller for now, or ensure deck.ts doesn't import interaction.ts).

4.  **Extract and Export Functions**:
    - Convert `toggleRead`, `toggleStar`, etc. to take `app: AppState` as first arg.
    - **Note on `toggleRead`**: It calls `manageDailyDeck` and `loadAndDisplayDeck` when the deck is empty. Ensure these imports are available.

5.  **Refactor**: Replace `this` with `app`.
