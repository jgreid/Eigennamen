/**
 * Word-List Library
 *
 * A client-side, localStorage-backed library of named custom word lists.
 * The app has no accounts and a first-class offline (standalone) mode, so the
 * library lives entirely in the browser — the same place custom words and the
 * word-list mode already persist. Picking a saved list simply repopulates the
 * custom-words field; the existing `wordList` array path carries it into a game
 * unchanged, in both standalone and multiplayer modes.
 *
 * A stable per-list `id` is minted here so a later tranche can forward it (with
 * the list name) as provenance the server records on the game/history — turning
 * the currently always-null `wordListId` field into something meaningful — and
 * so prepared bot semantic maps can be keyed to a specific saved list.
 */

import { safeGetItem, safeSetItem } from './utils.js';
import { MAX_CUSTOM_WORD_LIST_SIZE } from './state.js';

/** localStorage key holding the JSON-encoded array of saved lists. */
const STORAGE_KEY = 'eigennamen-wordlist-library';

/** Hard cap on how many lists a browser may keep, to bound storage growth. */
export const MAX_SAVED_LISTS = 50;

/** Hard cap on a saved list's display name length. */
export const MAX_LIST_NAME_LENGTH = 60;

/** A single named word list persisted in the library. */
export interface SavedWordList {
    /** Stable, opaque id (provenance / semantic-map key in later tranches). */
    id: string;
    /** User-facing name (trimmed, length-capped, never empty). */
    name: string;
    /** The words, already parsed/normalized by the caller. */
    words: string[];
    /** Epoch ms when first created. */
    createdAt: number;
    /** Epoch ms of the last save that touched this list. */
    updatedAt: number;
}

/** Discriminated result of a save attempt, so the UI can message precisely. */
export type SaveResult =
    | { ok: true; list: SavedWordList; overwritten: boolean }
    | { ok: false; reason: 'name' | 'empty' | 'full' | 'storage' };

/** Mint a stable id, preferring crypto.randomUUID with a safe fallback. */
function newId(): string {
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch {
        // fall through to the manual fallback below
    }
    return `wl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Narrow an unknown parsed entry to a well-formed SavedWordList (or null). */
function coerceEntry(raw: unknown): SavedWordList | null {
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.length === 0) return null;
    if (typeof e.name !== 'string' || e.name.trim().length === 0) return null;
    if (!Array.isArray(e.words)) return null;
    const words = e.words.filter((w): w is string => typeof w === 'string');
    if (words.length === 0) return null;
    const createdAt = typeof e.createdAt === 'number' ? e.createdAt : Date.now();
    const updatedAt = typeof e.updatedAt === 'number' ? e.updatedAt : createdAt;
    return {
        id: e.id,
        name: e.name.trim().slice(0, MAX_LIST_NAME_LENGTH),
        words: words.slice(0, MAX_CUSTOM_WORD_LIST_SIZE),
        createdAt,
        updatedAt,
    };
}

/**
 * Read all saved lists, most-recently-updated first. Resilient to a missing,
 * empty, non-JSON, or partially-corrupt store — bad entries are dropped rather
 * than throwing.
 */
export function getSavedLists(): SavedWordList[] {
    const raw = safeGetItem(STORAGE_KEY);
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];
    const lists = parsed.map(coerceEntry).filter((l): l is SavedWordList => l !== null);
    return lists.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Look up a single saved list by id. */
export function getSavedList(id: string): SavedWordList | null {
    return getSavedLists().find((l) => l.id === id) ?? null;
}

/** Persist the given lists array; returns false if storage rejected the write. */
function persist(lists: SavedWordList[]): boolean {
    return safeSetItem(STORAGE_KEY, JSON.stringify(lists));
}

/**
 * Save `words` under `name`. Saving with an existing name (case-insensitively)
 * overwrites that list in place, keeping its id — so re-saving after edits, and
 * plain renaming-by-resave, both work without piling up duplicates. A brand-new
 * name creates a new list, subject to MAX_SAVED_LISTS.
 */
export function saveList(name: string, words: string[]): SaveResult {
    const cleanName = name.trim().slice(0, MAX_LIST_NAME_LENGTH);
    if (cleanName.length === 0) return { ok: false, reason: 'name' };

    const cleanWords = words.filter((w) => typeof w === 'string' && w.length > 0).slice(0, MAX_CUSTOM_WORD_LIST_SIZE);
    if (cleanWords.length === 0) return { ok: false, reason: 'empty' };

    const lists = getSavedLists();
    const now = Date.now();
    const existing = lists.find((l) => l.name.toLowerCase() === cleanName.toLowerCase());

    let saved: SavedWordList;
    let overwritten: boolean;
    if (existing) {
        saved = { ...existing, name: cleanName, words: cleanWords, updatedAt: now };
        lists[lists.indexOf(existing)] = saved;
        overwritten = true;
    } else {
        if (lists.length >= MAX_SAVED_LISTS) return { ok: false, reason: 'full' };
        saved = { id: newId(), name: cleanName, words: cleanWords, createdAt: now, updatedAt: now };
        lists.push(saved);
        overwritten = false;
    }

    if (!persist(lists)) return { ok: false, reason: 'storage' };
    return { ok: true, list: saved, overwritten };
}

/** Delete a saved list by id. Returns true if a list was removed. */
export function deleteList(id: string): boolean {
    const lists = getSavedLists();
    const next = lists.filter((l) => l.id !== id);
    if (next.length === lists.length) return false;
    persist(next);
    return true;
}
