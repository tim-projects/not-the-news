# Refactor Task: Create `worker/src/handlers/feed.ts`

## Context
Handling feed-related API endpoints.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/handlers/feed.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate logic for:
    - `/api/refresh`
    - `/api/list`
    - `/api/lookup`
    - `/api/keys`

2.  **Create `worker/src/handlers/feed.ts`**.

3.  **Add Imports**:
    - `import { Env } from '../config.ts';`
    - `import { syncFeeds, getFeedItems, discoverFeeds } from '../services/feedFetcher.ts';`
    - `import { jsonResponse } from '../utils/response.ts';`

4.  **Extract and Export Functions**:
    - `handleFeedRefresh(request: Request, uid: string, env: Env)`
    - `handleFeedList(request: Request, uid: string, env: Env)`
    - `handleFeedLookup(request: Request, env: Env)`
    - `handleFeedKeys(request: Request, uid: string, env: Env)`

5.  **Refactor**: Copy logic from `index.ts`.
