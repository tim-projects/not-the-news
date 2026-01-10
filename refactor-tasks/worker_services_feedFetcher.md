# Refactor Task: Create `worker/src/services/feedFetcher.ts`

## Context
Refactoring RSS processing logic.

## Source File
- `worker/src/index.ts` (syncFeeds, discoverFeeds)
- `worker/src/rss.ts` (processFeeds)

## Target File
- `worker/src/services/feedFetcher.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate:
    - `syncFeeds`
    - `discoverFeeds`
    - `getFeedItems` (maybe)

2.  **Read `worker/src/rss.ts`** to see `processFeeds`.

3.  **Create `worker/src/services/feedFetcher.ts`**.

4.  **Add Imports**:
    - `import { Env } from '../config.ts';`
    - `import { processFeeds } from '../rss.ts';` (Keep `rss.ts` as a low-level parser or move its content here).
    - `import { Storage } from './storage.ts';`

5.  **Extract and Export Functions**:
    - `syncFeeds`
    - `discoverFeeds`
    - `getFeedItems`

6.  **Refactor**: These functions currently live in `index.ts` but belong in a service.
