# Refactor Task: Create `worker/src/router.ts`

## Context
Extracting the routing logic from the main `fetch` handler.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/router.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate the `fetch` handler logic (the big `if/else` block).

2.  **Create `worker/src/router.ts`**.

3.  **Add Imports**:
    - `import { Env } from './config.ts';`
    - Import handlers from `handlers/`.

4.  **Create Router Function**:
    - `export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>`
    - Move the routing logic here.

5.  **Refactor**: Delegate specific paths to handler functions (e.g., `handleUserRequest`, `handleFeedRequest`).
