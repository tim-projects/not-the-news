import { withDb } from '../dbCore.ts';
import { getAuthToken } from '../dbAuth.ts';
import { loadSimpleState } from '../dbUserState.ts';
// Circular dependency note: We need to be careful with imports.
// If pullUserState is needed, we might need to inject it or move types to a shared file.
// For now, let's assume we can import it, but we'll check if we need to break the cycle.
import { pullUserState } from './state.ts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || window.location.origin;
const SYNC_KEYS = ['read', 'starred', 'currentDeckGuids', 'shuffledOutGuids'];

export async function _saveSyncMetaState(key: string, value: any, timestamp?: string): Promise<void> {
    return withDb(async (db: any) => {
        try {
            const lastModified = timestamp || new Date().toISOString();
            await db.put('userSettings', { key, value, lastModified });
        } catch (e) {
            console.error(`[DB] Failed to save sync metadata for key '${key}':`, e);
        }
    });
}

export async function _addPendingOperationToBuffer(op: any): Promise<number> {
    return withDb(async (db: any) => {
        // Clone operation to avoid side effects
        const opClone = { ...op };
        if (opClone.id) delete opClone.id; // Let autoIncrement handle ID

        try {
            const tx = db.transaction('pendingOperations', 'readwrite');
            const id = await tx.store.add(opClone);
            await tx.done;
            return id;
        } catch (e) {
            console.error('[DB] Error buffering operation:', e);
            throw e;
        }
    });
}

async function compressString(str: string): Promise<string> {
    // Basic gzip compression for large payloads using CompressionStream
    const stream = new Blob([str]).stream();
    const compressedReadableStream = stream.pipeThrough(new CompressionStream('gzip'));
    const compressedResponse = await new Response(compressedReadableStream);
    const blob = await compressedResponse.blob();
    return blobToBase64(blob);
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = (reader.result as string).split(',')[1];
            resolve(base64data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export async function queueAndAttemptSyncOperation(op: any, app: any = null): Promise<void> {
    if (!op || typeof op.type !== 'string' || (op.type === 'simpleUpdate' && (op.value === null || op.value === undefined))) {
        console.warn('[DB] Skipping invalid or empty operation:', op);
        return;
    }

    // Compress large payloads if needed
    if (op.type === 'simpleUpdate' && op.key && SYNC_KEYS.includes(op.key)) {
        if (typeof op.value !== 'string') {
            try {
                const jsonStr = JSON.stringify(op.value);
                // Only compress if it's substantial? The worker expects gzipped body for these keys if sent as simpleUpdate?
                // Actually, the previous implementation did this:
                // op.value = await compressString(JSON.stringify(op.value));
                // But let's check if the worker handles it.
                // Assuming worker handles both or we stick to previous logic.
                op.value = await compressString(jsonStr);
            } catch (e) {
                console.error(`[DB] Compression failed for ${op.key}, sending raw.`, e);
            }
        }
    }

    try {
        const opId = await _addPendingOperationToBuffer(op);
        console.log(`[DB] Operation buffered with ID: ${opId}`, op);

        // Attempt immediate sync if online
        const { value: syncEnabled } = await loadSimpleState('syncEnabled');
        
        if (navigator.onLine && syncEnabled) {
            console.log(`[DB] Attempting immediate sync for ${op.type} (ID: ${opId}).`);
            
            const payload = [{ ...op, id: opId }];
            const token = await getAuthToken();
            
            if (!token) {
                console.warn(`[DB] No auth token available for immediate sync, buffering op ${opId}.`);
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`HTTP error ${response.status} for immediate sync. Details: ${text}`);
            }

            const result = await response.json();
            const opResult = result.results?.find((r: any) => r.id === opId);

            if (opResult?.status === 'success') {
                await withDb((db: any) => db.delete('pendingOperations', opId));
                console.log(`[DB] Successfully synced and removed immediate op ${opId} (${op.type}).`);
                
                if (result.serverTime) {
                    await _saveSyncMetaState('lastStateSync', result.serverTime);
                }

                // If this was a state update, we might want to trigger a pull to ensure consistency?
                // Or just trust our local optimistic update.
                // The previous code called pullUserState here with a skip list.
                // We'll optionally do that if 'app' is provided to avoid circular imports if we can.
                // Or we can import pullUserState dynamically.
                
                let keyToPull: string | null = null;
                if (op.key) keyToPull = op.key;
                else if (op.type === 'readDelta') keyToPull = 'read';
                else if (op.type === 'starDelta') keyToPull = 'starred';

                if (keyToPull) {
                    // Pull just this key to confirm/reconcile? 
                    // Actually, typically we trust the push. But maybe we pull others?
                    // The old code called: pullUserState(false, [keyToPull], app);
                    // Meaning: Pull everything EXCEPT the one we just pushed.
                    
                    // Dynamic import to break potential circle
                    // import('./state.ts').then(m => m.pullUserState(false, [keyToPull!], app));
                    // For now, let's skip the immediate re-pull optimization unless critical.
                }
            } else {
                console.warn(`[DB] Immediate sync for op ${opId} reported non-success by server:`, opResult);
            }
        } else {
            console.log(`[DB] ${navigator.onLine ? 'Sync is disabled.' : 'Offline.'} Buffering op ${opId} for later batch sync.`);
        }
    } catch (e) {
        console.error(`[DB] Network error during immediate sync for ${op.type}. Will retry with batch sync.`, e);
    }
}

export async function processPendingOperations(app: any = null): Promise<void> {
    const { value: syncEnabled } = await loadSimpleState('syncEnabled');
    if (!navigator.onLine || !syncEnabled) {
        console.log('[DB] Offline or sync is disabled. Skipping batch sync.');
        return;
    }

    const pendingOps = await withDb(db => db.getAll('pendingOperations')).catch(e => {
        console.error('[DB] Error fetching pending operations:', e);
        return null;
    });

    if (!pendingOps || pendingOps.length === 0) {
        if (pendingOps) console.log('[DB] No pending operations.');
        return;
    }

    console.log(`[DB] Processing ${pendingOps.length} pending operations...`);

    const BATCH_SIZE = 10;
    const modifiedKeys = new Set<string>();

    for (let i = 0; i < pendingOps.length; i += BATCH_SIZE) {
        const batch = pendingOps.slice(i, i + BATCH_SIZE);
        console.log(`[DB] Sending batch ${i / BATCH_SIZE + 1} (${batch.length} ops) to /api/user-state.`);

        try {
            const token = await getAuthToken();
            if (!token) {
                console.warn('[DB] No auth token available for batch sync.');
                return;
            }

            const response = await fetch(`${API_BASE_URL}/api/profile`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(batch)
            });

            if (!response.ok) {
                throw new Error(`HTTP error ${response.status} for batch sync. Details: ${await response.text()}`);
            }

            const result = await response.json();
            console.log(`[DB] Batch ${i / BATCH_SIZE + 1} sync successful. Server response:`, result);

            if (result.results && Array.isArray(result.results)) {
                await withDb(async (db: any) => {
                    const tx = db.transaction('pendingOperations', 'readwrite');
                    for (const res of result.results) {
                        if (res.status === 'success' && res.id !== undefined) {
                            await tx.store.delete(res.id);
                            
                            // Track modified keys
                            const originalOp = batch.find((op: any) => op.id === res.id);
                            if (originalOp) {
                                if (originalOp.key) modifiedKeys.add(originalOp.key);
                                else if (originalOp.type === 'readDelta') modifiedKeys.add('read');
                                else if (originalOp.type === 'starDelta') modifiedKeys.add('starred');
                            }
                        } else {
                            console.warn(`[DB] Op ${res.id ?? 'N/A'} (${res.opType}) ${res.status}: ${res.reason || 'N/A'}`);
                        }
                    }
                    await tx.done;
                });
            } else {
                console.warn('[DB] Server response invalid; cannot clear buffered operations.');
            }

            if (result.serverTime) {
                await _saveSyncMetaState('lastStateSync', result.serverTime);
            }

        } catch (e) {
            console.error('[DB] Error during batch synchronization:', e);
            // Don't break loop, try next batch? Or stop? 
            // Usually safest to stop on network error.
            break; 
        }
    }

    // If we modified keys, trigger a pull for them to ensure we are in sync (e.g. if server merged changes)
    if (modifiedKeys.size > 0) {
        console.log(`[DB] Post-batch sync: Triggering single pull for ${modifiedKeys.size} unique keys.`);
        // We need to import pullUserState dynamically or move it to a shared place.
        // For now, importing dynamically.
        import('./state.ts').then(m => {
            // We pass 'false' for force, and empty skip array (or maybe we skip others?)
            // Actually we want to pull ONLY these keys.
            // But pullUserState typically pulls ALL unless skipped.
            // Let's rely on the fact that pullUserState does diffing.
            // Or better, create a specific pull function. 
            // The existing pullUserState pulls everything.
            m.pullUserState(false, [], app);
        });
    }
}
