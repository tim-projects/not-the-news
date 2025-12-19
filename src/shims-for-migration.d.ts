// src/shims-for-migration.d.ts
declare module '../data/dbUserState.ts' {
    export function loadSimpleState(key: string): Promise<{ value: any }>;
    export function saveSimpleState(key: string, value: any): Promise<void>;
    export function loadArrayState(key: string): Promise<{ value: any[] }>;
    export function saveArrayState(key: string, value: any[]): Promise<void>;
    export function queueAndAttemptSyncOperation(op: any): Promise<void>;
    export function updateArrayState(storeName: string, item: any, add: boolean): Promise<void>;
    export function overwriteArrayAndSyncChanges(storeName: string, newObjects: any[]): Promise<void>;
}
declare module '../utils/connectivity.js' {
    export function isOnline(): boolean;
}

declare module 'alpinejs';