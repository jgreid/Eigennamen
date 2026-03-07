// Bull Fascinator — IndexedDB storage

const DB_NAME = 'bull-fascinator';
const DB_VERSION = 1;
const STORE_NAME = 'data';

export class Storage {
    constructor() {
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve();
            };

            request.onerror = (e) => {
                console.warn('IndexedDB open failed, using memory fallback:', e);
                this._fallback = {};
                resolve();
            };
        });
    }

    async get(key) {
        if (!this.db) return this._fallback?.[key] ?? null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result?.value ?? null);
            req.onerror = () => resolve(null);
        });
    }

    async set(key, value) {
        if (!this.db) {
            if (this._fallback) this._fallback[key] = value;
            return;
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.put({ key, value });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async delete(key) {
        if (!this.db) {
            if (this._fallback) delete this._fallback[key];
            return;
        }

        return new Promise((resolve) => {
            const tx = this.db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }

    async getAll() {
        if (!this.db) return this._fallback ? Object.entries(this._fallback).map(([k, v]) => ({ key: k, value: v })) : [];

        return new Promise((resolve) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }
}
