/**
 * Safe browser storage utilities for the Codenames WebSocket Client.
 *
 * Extracted from socket-client.ts. These functions handle
 * QuotaExceededError (private browsing) and other storage access errors
 * so callers can use storage without try/catch at every call site.
 */
import { logger } from './logger.js';
/**
 * Safely set item in storage with quota error handling.
 * Handles QuotaExceededError for private browsing mode.
 * @param storage - sessionStorage or localStorage
 * @param key - Storage key
 * @param value - Value to store
 * @returns True if successful
 */
export function safeSetStorage(storage, key, value) {
    try {
        storage.setItem(key, value);
        return true;
    }
    catch (e) {
        // QuotaExceededError in private browsing or when storage is full
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            logger.warn(`Storage quota exceeded for ${key}, continuing without persistence`);
        }
        else {
            logger.error(`Storage error for ${key}:`, e);
        }
        return false;
    }
}
/**
 * Safely get item from storage.
 * Handles storage access errors.
 * @param storage - sessionStorage or localStorage
 * @param key - Storage key
 * @returns Stored value or null
 */
export function safeGetStorage(storage, key) {
    try {
        return storage.getItem(key);
    }
    catch (e) {
        logger.warn(`Storage access error for ${key}:`, e);
        return null;
    }
}
/**
 * Safely remove item from storage.
 * Handles storage access errors.
 * @param storage - sessionStorage or localStorage
 * @param key - Storage key
 */
export function safeRemoveStorage(storage, key) {
    try {
        storage.removeItem(key);
    }
    catch (e) {
        logger.warn(`Storage removal error for ${key}:`, e);
    }
}
//# sourceMappingURL=socket-client-storage.js.map