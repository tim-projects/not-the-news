import { Env } from '../config.ts';

export class Storage {
    static async get(key: string, env: Env): Promise<any> {
        if (!env.NTN_KV) return null;
        try {
            const val = await env.NTN_KV.get(key);
            return val ? JSON.parse(val) : null;
        } catch (e) {
            console.error(`KV Get Error (${key}):`, e);
            return null;
        }
    }

    static async put(key: string, value: any, env: Env): Promise<void> {
        if (!env.NTN_KV) return;
        try {
            await env.NTN_KV.put(key, JSON.stringify(value));
        } catch (e) {
            console.error(`KV Put Error (${key}):`, e);
        }
    }

    static async loadState(uid: string, key: string, env: Env): Promise<{ value: any, lastModified: string }> {
        const fullKey = `user:${uid}:${key}`;
        const data = await Storage.get(fullKey, env);
        return {
            value: data?.value ?? null,
            lastModified: data?.lastModified ?? new Date().toISOString()
        };
    }

    static async saveState(uid: string, key: string, value: any, env: Env): Promise<string> {
        const fullKey = `user:${uid}:${key}`;
        const lastModified = new Date().toISOString();
        await Storage.put(fullKey, { value, lastModified }, env);
        return lastModified;
    }
}
