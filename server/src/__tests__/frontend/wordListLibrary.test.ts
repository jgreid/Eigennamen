/**
 * Frontend Word-List Library Tests
 *
 * Covers the localStorage-backed CRUD in src/frontend/wordListLibrary.ts:
 * getSavedLists, getSavedList, saveList (create + overwrite-by-name), deleteList,
 * plus caps, corruption resilience, and recency ordering.
 * Test environment: jsdom (provides a real localStorage).
 */

// Use the real localStorage that jsdom provides, via the safe wrappers.
jest.mock('../../frontend/utils', () => ({
    safeGetItem: jest.fn((key: string, fallback: string | null = null) => {
        const v = localStorage.getItem(key);
        return v !== null ? v : fallback;
    }),
    safeSetItem: jest.fn((key: string, value: string) => {
        localStorage.setItem(key, value);
        return true;
    }),
}));

jest.mock('../../frontend/state', () => ({
    MAX_CUSTOM_WORD_LIST_SIZE: 2000,
}));

const {
    getSavedLists,
    getSavedList,
    saveList,
    deleteList,
    MAX_SAVED_LISTS,
    MAX_LIST_NAME_LENGTH,
} = require('../../frontend/wordListLibrary');

const STORAGE_KEY = 'eigennamen-wordlist-library';
const words = (n: number) => Array.from({ length: n }, (_, i) => `WORD${i}`);

beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
});

describe('getSavedLists', () => {
    test('returns [] when nothing is stored', () => {
        expect(getSavedLists()).toEqual([]);
    });

    test('returns [] on non-JSON garbage', () => {
        localStorage.setItem(STORAGE_KEY, 'not json{{{');
        expect(getSavedLists()).toEqual([]);
    });

    test('returns [] when the stored value is not an array', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'x' }));
        expect(getSavedLists()).toEqual([]);
    });

    test('drops malformed entries but keeps valid ones', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                { id: 'a', name: 'Good', words: ['A', 'B'], createdAt: 1, updatedAt: 1 },
                { id: '', name: 'No id', words: ['A'] }, // dropped: empty id
                { id: 'b', name: '   ', words: ['A'] }, // dropped: blank name
                { id: 'c', name: 'No words', words: [] }, // dropped: empty words
                'garbage', // dropped: not an object
            ])
        );
        const lists = getSavedLists();
        expect(lists).toHaveLength(1);
        expect(lists[0].id).toBe('a');
    });

    test('orders most-recently-updated first', () => {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify([
                { id: 'old', name: 'Old', words: ['A'], createdAt: 1, updatedAt: 100 },
                { id: 'new', name: 'New', words: ['A'], createdAt: 1, updatedAt: 300 },
                { id: 'mid', name: 'Mid', words: ['A'], createdAt: 1, updatedAt: 200 },
            ])
        );
        expect(getSavedLists().map((l: { id: string }) => l.id)).toEqual(['new', 'mid', 'old']);
    });
});

describe('saveList', () => {
    test('creates a new list and returns it', () => {
        const result = saveList('Sci-Fi', words(30));
        expect(result.ok).toBe(true);
        expect(result.overwritten).toBe(false);
        expect(result.list.name).toBe('Sci-Fi');
        expect(result.list.words).toHaveLength(30);
        expect(typeof result.list.id).toBe('string');
        expect(result.list.id.length).toBeGreaterThan(0);

        const stored = getSavedList(result.list.id);
        expect(stored).not.toBeNull();
        expect(stored.name).toBe('Sci-Fi');
    });

    test('overwrites an existing name case-insensitively, keeping the id', () => {
        const first = saveList('Movies', words(25));
        const second = saveList('MOVIES', words(40));
        expect(second.ok).toBe(true);
        expect(second.overwritten).toBe(true);
        expect(second.list.id).toBe(first.list.id);
        expect(second.list.words).toHaveLength(40);
        // Still only one list total
        expect(getSavedLists()).toHaveLength(1);
    });

    test('rejects an empty name', () => {
        const result = saveList('   ', words(25));
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('name');
    });

    test('rejects an empty word set', () => {
        const result = saveList('Empty', []);
        expect(result.ok).toBe(false);
        expect(result.reason).toBe('empty');
    });

    test('trims and length-caps the name', () => {
        const longName = 'x'.repeat(MAX_LIST_NAME_LENGTH + 20);
        const result = saveList(`  ${longName}  `, words(25));
        expect(result.ok).toBe(true);
        expect(result.list.name).toHaveLength(MAX_LIST_NAME_LENGTH);
    });

    test('caps words at MAX_CUSTOM_WORD_LIST_SIZE', () => {
        const result = saveList('Huge', words(2500));
        expect(result.ok).toBe(true);
        expect(result.list.words).toHaveLength(2000);
    });

    test('rejects a brand-new list once MAX_SAVED_LISTS is reached', () => {
        for (let i = 0; i < MAX_SAVED_LISTS; i++) {
            expect(saveList(`List ${i}`, words(25)).ok).toBe(true);
        }
        const overflow = saveList('One too many', words(25));
        expect(overflow.ok).toBe(false);
        expect(overflow.reason).toBe('full');
        // ...but overwriting an existing name at the cap still works
        const overwrite = saveList('List 0', words(26));
        expect(overwrite.ok).toBe(true);
        expect(overwrite.overwritten).toBe(true);
    });
});

describe('deleteList', () => {
    test('removes a list by id and reports success', () => {
        const a = saveList('A', words(25));
        const b = saveList('B', words(25));
        expect(deleteList(a.list.id)).toBe(true);
        expect(getSavedList(a.list.id)).toBeNull();
        expect(getSavedList(b.list.id)).not.toBeNull();
        expect(getSavedLists()).toHaveLength(1);
    });

    test('returns false when the id is not present', () => {
        saveList('A', words(25));
        expect(deleteList('nonexistent')).toBe(false);
        expect(getSavedLists()).toHaveLength(1);
    });

    test('returns false when the pruned library cannot be persisted (storage write fails)', () => {
        const { safeSetItem } = require('../../frontend/utils');
        const a = saveList('A', words(25)); // create write succeeds
        safeSetItem.mockReturnValueOnce(false); // the delete's write fails (quota / private mode)

        // The list existed, so it's not a "not found" false — it's a write-failure
        // false. Callers rely on this to avoid reporting a phantom "Deleted".
        expect(deleteList(a.list.id)).toBe(false);
        // The prune was never persisted, so the list is still there.
        expect(getSavedList(a.list.id)).not.toBeNull();
    });
});
