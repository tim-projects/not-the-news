# Refactor Task: Create `worker/src/handlers/api.ts`

## Context
Handling general API endpoints.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/handlers/api.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate logic for:
    - `/api/time`
    - `/api/login` (legacy check)

2.  **Create `worker/src/handlers/api.ts`**.

3.  **Add Imports**:
    - `import { jsonResponse } from '../utils/response.ts';`

4.  **Extract and Export Functions**:
    - `handleTimeRequest()`
    - `handleLoginRequest()`

5.  **Refactor**: Copy logic from `index.ts`.
