# Refactor Task: Create `worker/src/services/storage.ts`

## Context
Extracting the `Storage` class from `worker/src/index.ts`.

## Source File
- `worker/src/index.ts`

## Target File
- `worker/src/services/storage.ts`

## Instructions
1.  **Read `worker/src/index.ts`** to locate the `class Storage { ... }`.

2.  **Create `worker/src/services/storage.ts`**.

3.  **Add Imports**:
    - `import { Env } from '../config.ts';` (You'll need to create config.ts or import Env from index.ts if circularity permits. Better to move Env definition to a shared file).
    - *Note: If `Env` isn't separated yet, duplicate the interface locally for now or create `worker/src/config.ts` first.*

4.  **Extract and Export Class**:
    - Copy the entire `Storage` class.
    - Export it: `export class Storage { ... }`.

5.  **Refactor**: Ensure it uses the `Env` interface correctly.
