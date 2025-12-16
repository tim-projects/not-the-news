declare module 'idb' {
    export function openDB(name: string, version?: number, callbacks?: any): Promise<any>;
    export function deleteDB(name: string, options?: any): Promise<void>;
    export function wrap<T>(value: T): T;
    export function unwrap<T>(value: T): T;
}
