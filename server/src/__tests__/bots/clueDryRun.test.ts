/**
 * Guesser dry-run (bots/llm/clueDryRun.ts): after the spymaster picks a clue,
 * one extra LLM call simulates the clicker's read of it, and the ranking —
 * read WITH the key — vetoes assassin-in-reach clues, trims intrusions out of
 * the promise, and raises the number over a strong clean own-card prefix.
 * Every failure leaves the clue exactly as chosen.
 */
import type { DryRunBoard } from '../../bots/llm/clueDryRun';

// Mock the SDK before importing the module under test (same pattern as
// llmAdvice.test.ts): getClient() lazily requires it.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })));

import { adjustClueFromDryRun, dryRunChosenClue, dryRunAdviceConfig } from '../../bots/llm/clueDryRun';
import { resetLLMClientForTests } from '../../bots/llm/llmAdvice';

// Board: 3 own (red), 1 opponent, 1 neutral, 1 assassin.
const WORDS = ['BEAR', 'LION', 'TIGER', 'CAR', 'TREE', 'ALIEN'];
const TYPES = ['red', 'red', 'red', 'blue', 'neutral', 'assassin'];
const board = (over: Partial<DryRunBoard> = {}): DryRunBoard => ({
    words: WORDS,
    revealed: WORDS.map(() => false),
    types: TYPES,
    team: 'red',
    ...over,
});
const scores = (entries: Record<string, number>): Map<string, number> => new Map(Object.entries(entries));

describe('adjustClueFromDryRun (pure)', () => {
    it('leaves an agreeing ranking untouched', () => {
        const s = scores({ BEAR: 0.9, LION: 0.8, TIGER: 0.2, CAR: 0.1, TREE: 0.1, ALIEN: 0.0 });
        expect(adjustClueFromDryRun(board(), s, 2)).toEqual({ number: 2, veto: false });
    });

    it('trims the number when a non-own card intrudes inside the promise', () => {
        // The guesser reads the neutral TREE ahead of the second own card.
        const s = scores({ BEAR: 0.9, TREE: 0.8, LION: 0.7, TIGER: 0.2, CAR: 0.1, ALIEN: 0.0 });
        expect(adjustClueFromDryRun(board(), s, 2)).toEqual({ number: 1, veto: false });
    });

    it('raises the number over a strong clean own-card prefix (the 1-clue treadmill fix)', () => {
        const s = scores({ BEAR: 0.9, LION: 0.8, TIGER: 0.6, CAR: 0.1, TREE: 0.1, ALIEN: 0.0 });
        expect(adjustClueFromDryRun(board(), s, 1)).toEqual({ number: 3, veto: false });
    });

    it('never raises over weak reads — a cold argmax is not a promise', () => {
        // The prefix is clean own cards, but only the top read clears the
        // raise bar (0.5): the tail is argmax noise, not conviction.
        const s = scores({ BEAR: 0.9, LION: 0.4, TIGER: 0.3, CAR: 0.1, TREE: 0.1, ALIEN: 0.0 });
        expect(adjustClueFromDryRun(board(), s, 1)).toEqual({ number: 1, veto: false });
    });

    it('vetoes when the assassin is the top read', () => {
        const s = scores({ ALIEN: 0.9, BEAR: 0.8, LION: 0.7, TIGER: 0.2, CAR: 0.1, TREE: 0.1 });
        expect(adjustClueFromDryRun(board(), s, 2).veto).toBe(true);
    });

    it('vetoes at assassin rank 1: the engine +1 grant reaches it even at number 1', () => {
        const s = scores({ BEAR: 0.9, ALIEN: 0.8, LION: 0.7, TIGER: 0.2, CAR: 0.1, TREE: 0.1 });
        expect(adjustClueFromDryRun(board(), s, 1).veto).toBe(true);
    });

    it('caps the number so the +1 grant stops short of a deeper assassin', () => {
        // Two clean own reads, assassin third: number 2 would grant 3 guesses.
        const s = scores({ BEAR: 0.9, LION: 0.8, ALIEN: 0.7, TIGER: 0.2, CAR: 0.1, TREE: 0.1 });
        expect(adjustClueFromDryRun(board(), s, 2)).toEqual({ number: 1, veto: false });
    });

    it('caps a raise at the remaining own cards and ignores revealed cards entirely', () => {
        // TIGER (own) and ALIEN (assassin!) already revealed: neither the
        // assassin's hot stale score nor the revealed own card count.
        const revealed = WORDS.map((w) => w === 'TIGER' || w === 'ALIEN');
        const s = scores({ ALIEN: 1.0, TIGER: 0.95, BEAR: 0.9, LION: 0.8, CAR: 0.1, TREE: 0.1 });
        expect(adjustClueFromDryRun(board({ revealed }), s, 5)).toEqual({ number: 2, veto: false });
    });

    it('floors at 1 even when the guesser reads nothing clean', () => {
        // Top read is the opponent's card: cleanPrefix 0, but a clue of 0
        // would be an anti-clue — the trim floors at 1.
        const s = scores({ CAR: 0.9, BEAR: 0.8, LION: 0.7, TIGER: 0.2, TREE: 0.1, ALIEN: 0.0 });
        expect(adjustClueFromDryRun(board(), s, 2)).toEqual({ number: 1, veto: false });
    });
});

describe('dryRunChosenClue / dryRunAdviceConfig', () => {
    const VARS = ['BOT_LLM_MODEL', 'BOT_LLM_MODEL_SPYMASTER', 'BOT_LLM_MODEL_CLICKER'] as const;
    const prev: Record<string, string | undefined> = {};
    beforeEach(() => {
        mockCreate.mockReset();
        resetLLMClientForTests();
        for (const v of VARS) {
            prev[v] = process.env[v];
            delete process.env[v];
        }
    });
    afterEach(() => {
        for (const v of VARS) {
            if (prev[v] === undefined) delete process.env[v];
            else process.env[v] = prev[v];
        }
    });
    const reply = (obj: unknown): { content: Array<{ type: string; text: string }> } => ({
        content: [{ type: 'text', text: JSON.stringify(obj) }],
    });

    it('refines the number from the simulated ranking', async () => {
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        mockCreate.mockResolvedValue(
            reply({ scores: { BEAR: 0.9, TREE: 0.8, LION: 0.7, TIGER: 0.2, CAR: 0.1, ALIEN: 0.0 } })
        );
        expect(await dryRunChosenClue(board(), 'FOREST', 2)).toEqual({ number: 1, veto: false });
    });

    it('returns the clue unchanged on any failure, and never calls the API when disabled', async () => {
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        mockCreate.mockRejectedValue(new Error('timeout'));
        expect(await dryRunChosenClue(board(), 'FOREST', 2)).toEqual({ number: 2, veto: false });

        delete process.env.BOT_LLM_MODEL;
        mockCreate.mockClear();
        expect(await dryRunChosenClue(board(), 'FOREST', 2)).toEqual({ number: 2, veto: false });
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('bills the spymaster seat, falling back to the clicker so clicker-only setups verify too', () => {
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        process.env.BOT_LLM_MODEL_SPYMASTER = 'claude-opus-4-8';
        expect(dryRunAdviceConfig().model).toBe('claude-opus-4-8');

        process.env.BOT_LLM_MODEL_SPYMASTER = 'off';
        process.env.BOT_LLM_MODEL_CLICKER = 'claude-haiku-4-5';
        expect(dryRunAdviceConfig().model).toBe('claude-haiku-4-5');
    });
});
