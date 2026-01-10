# Refactor Task: Create `worker/src/handlers/user.ts`

## Context
Handling user-related API endpoints.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/handlers/user.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate logic for:
    - `/api/profile` (GET/POST)
    - `/api/user-state`
    - `/api/admin/*`

2.  **Create `worker/src/handlers/user.ts`**.

3.  **Add Imports**:
    - `import { Env } from '../config.ts';`
    - `import { Storage } from '../services/storage.ts';`
    - `import { jsonResponse, errorResponse } from '../utils/response.ts';`

4.  **Extract and Export Functions**:
    - `handleUserProfile(request: Request, uid: string, env: Env)`
    - `handleAdminRequest(request: Request, uid: string, env: Env)`

5.  **Refactor**: Copy logic from `index.ts`.
