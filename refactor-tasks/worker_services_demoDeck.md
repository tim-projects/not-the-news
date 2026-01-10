# Refactor Task: Create `worker/src/services/demoDeck.ts`

## Context
Extracting demo deck generation logic.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/services/demoDeck.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate:
    - `generateDemoDeck`
    - `fetchDemoDeck`

2.  **Create `worker/src/services/demoDeck.ts`**.

3.  **Add Imports**:
    - `import { Env } from '../config.ts';`
    - `import { processFeeds } from '../rss.ts';` (Or move processFeeds to services/feedFetcher.ts)
    - `import { USER_STATE_SERVER_DEFAULTS } from '../index.ts';` (Need to handle constants. Move defaults to `utils/constants.ts` or similar).

4.  **Extract and Export Functions**:
    - `generateDemoDeck(env: Env)`
    - `fetchDemoDeck(env: Env)`

5.  **Refactor**: Ensure dependencies are met.
