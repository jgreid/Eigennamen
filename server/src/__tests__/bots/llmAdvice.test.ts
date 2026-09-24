/**
 * Opt-in LLM advice layer (docs/BOT_LLM.md): the advice calls parse defensively
 * and fail to null (never throw), and the strategies consume advice as data —
 * with every deterministic safety gate still in charge of what is emitted.
 */
import type { BotClickerView, BotContext, BotSpymasterView, SkillParams } from '../../bots/strategies/types';
import { makeGreedyClicker } from '../../bots/strategies/clickers';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { suggestGuesses } from '../../bots/strategies/advisor';
import { tableBackend } from '../../bots/semantics/tableBackend';
import type { SemanticBackend } from '../../bots/semantics/backend';
import { makeRng } from '../../bots/rng';

// Mock the SDK before importing the module under test: getClient() lazily
// requires it, so the mock constructor is what new Anthropic() resolves to.
const mockCreate = jest.fn();
jest.mock('@anthropic-ai/sdk', () => jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })));

import {
    isLLMAdviceEnabled,
    llmAdviceConfig,
    proposeClues,
    rankGuesses,
    resetLLMClientForTests,
} from '../../bots/llm/llmAdvice';

const skill = (over: Partial<SkillParams> = {}): SkillParams => ({
    temperature: 0,
    blunderRate: 0,
    riskAversion: 0.6,
    seed: 1,
    ...over,
});
const ctx = (s: SkillParams, llm?: BotContext['llm']): BotContext => ({
    gameMode: 'classic',
    skill: s,
    rng: makeRng(1),
    ...(llm ? { llm } : {}),
});

const spymasterView = (): BotSpymasterView => ({
    role: 'spymaster',
    team: 'red',
    gameMode: 'classic',
    words: ['BEAR', 'LION', 'CAR', 'ALIEN', 'TREE'],
    revealed: [false, false, false, false, false],
    types: ['red', 'red', 'blue', 'assassin', 'neutral'],
    currentTurn: 'red',
});

const clickerView = (clue: string, number: number, guessesUsed = 0): BotClickerView => ({
    role: 'clicker',
    team: 'red',
    gameMode: 'classic',
    words: ['BEAR', 'LION', 'CAR', 'ALIEN', 'TREE'],
    revealed: [false, false, false, false, false],
    types: [null, null, null, null, null],
    currentTurn: 'red',
    currentClue: { word: clue, number, team: 'red' },
    guessesUsed,
    guessesAllowed: number + 1,
});

const reply = (obj: unknown): { content: Array<{ type: string; text: string }> } => ({
    content: [{ type: 'text', text: JSON.stringify(obj) }],
});

const CFG = { model: 'claude-sonnet-5', timeoutMs: 2000 };

beforeEach(() => {
    mockCreate.mockReset();
    resetLLMClientForTests();
});

describe('config gates', () => {
    const VARS = ['BOT_LLM_MODEL', 'BOT_LLM_MODEL_SPYMASTER', 'BOT_LLM_MODEL_CLICKER'] as const;
    const prev: Record<string, string | undefined> = {};
    beforeEach(() => {
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

    it('is disabled without BOT_LLM_MODEL and enabled with it', () => {
        expect(isLLMAdviceEnabled()).toBe(false);
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        expect(isLLMAdviceEnabled()).toBe(true);
        expect(llmAdviceConfig()).toEqual({ model: 'claude-sonnet-5', timeoutMs: 8000 });
    });

    it('per-seat overrides beat the base model; unset seats fall back', () => {
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        process.env.BOT_LLM_MODEL_CLICKER = 'claude-haiku-4-5';
        expect(llmAdviceConfig('clicker').model).toBe('claude-haiku-4-5');
        expect(llmAdviceConfig('spymaster').model).toBe('claude-sonnet-5');
        expect(llmAdviceConfig().model).toBe('claude-sonnet-5');
    });

    it('a per-seat override alone enables the layer for that seat only', () => {
        process.env.BOT_LLM_MODEL_CLICKER = 'claude-haiku-4-5';
        expect(isLLMAdviceEnabled()).toBe(true);
        expect(llmAdviceConfig('clicker').model).toBe('claude-haiku-4-5');
        expect(llmAdviceConfig('spymaster').model).toBe('');
    });

    it("the 'off' sentinel disables a seat, and a disabled seat never calls the API", async () => {
        process.env.BOT_LLM_MODEL = 'claude-sonnet-5';
        process.env.BOT_LLM_MODEL_SPYMASTER = 'off';
        expect(isLLMAdviceEnabled()).toBe(true); // clicker still on
        const cfg = llmAdviceConfig('spymaster');
        expect(cfg.model).toBe('');
        expect(await proposeClues(spymasterView(), cfg)).toBeNull();
        expect(mockCreate).not.toHaveBeenCalled();
    });

    it('constructs the SDK client with retries disabled (one attempt per decision)', async () => {
        const MockAnthropic = jest.requireMock('@anthropic-ai/sdk') as jest.Mock;
        MockAnthropic.mockClear();
        mockCreate.mockResolvedValue(reply({ scores: { BEAR: 0.9 } }));
        await rankGuesses(clickerView('animal', 1), CFG);
        expect(MockAnthropic).toHaveBeenCalledWith({ maxRetries: 0 });
    });
});

describe('proposeClues', () => {
    it('parses proposals, clamps numbers, and drops malformed entries', async () => {
        mockCreate.mockResolvedValue(
            reply({
                proposals: [
                    { word: 'FAUNA', number: 2, targets: ['BEAR', 'LION'] },
                    { word: 'two words', number: 1, targets: [] }, // spaces — dropped
                    { word: 'BIG', number: 99, targets: [] }, // clamped to 9
                    { number: 1 }, // no word — dropped
                ],
            })
        );
        const out = await proposeClues(spymasterView(), CFG);
        expect(out).toEqual([
            { word: 'FAUNA', number: 2, targets: ['BEAR', 'LION'] },
            { word: 'BIG', number: 9, targets: [] },
        ]);
    });

    it('returns null on malformed output, API errors, and empty payloads', async () => {
        mockCreate.mockResolvedValue(reply({ nope: true }));
        expect(await proposeClues(spymasterView(), CFG)).toBeNull();
        mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'sorry, no' }] });
        expect(await proposeClues(spymasterView(), CFG)).toBeNull();
        mockCreate.mockRejectedValue(new Error('timeout'));
        expect(await proposeClues(spymasterView(), CFG)).toBeNull();
        mockCreate.mockResolvedValue(reply({ proposals: [] }));
        expect(await proposeClues(spymasterView(), CFG)).toBeNull();
    });

    it('appends the URGENT ENDGAME directive only when mustCover is set', async () => {
        mockCreate.mockResolvedValue(reply({ proposals: [{ word: 'FAUNA', number: 2, targets: [] }] }));
        await proposeClues(spymasterView(), CFG, { mustCover: ['BEAR', 'LION'] });
        const promptOf = (call: unknown[]): string =>
            (call[0] as { messages: Array<{ content: string }> }).messages[0]!.content;
        const urgent = promptOf(mockCreate.mock.calls[0]!);
        expect(urgent).toContain('URGENT ENDGAME');
        expect(urgent).toContain('BEAR, LION');
        expect(urgent).toContain('number 2');
        mockCreate.mockClear();
        mockCreate.mockResolvedValue(reply({ proposals: [{ word: 'FAUNA', number: 2, targets: [] }] }));
        await proposeClues(spymasterView(), CFG);
        expect(promptOf(mockCreate.mock.calls[0]!)).not.toContain('URGENT ENDGAME');
    });

    it('the system prompt bans translations/abbreviations of board words (the AMBASSADE/NYC class)', async () => {
        mockCreate.mockResolvedValue(reply({ proposals: [{ word: 'FAUNA', number: 2, targets: [] }] }));
        await proposeClues(spymasterView(), CFG);
        const system = (mockCreate.mock.calls[0]![0] as { system: string }).system;
        expect(system).toContain('translation');
        expect(system).toContain('abbreviation');
    });
});

describe('rankGuesses', () => {
    it('keeps only real board words, normalized, with clamped scores', async () => {
        mockCreate.mockResolvedValue(
            reply({ scores: { bear: 0.9, LION: 1.7, INVENTED: 0.8, CAR: -1, ALIEN: 'high' } })
        );
        const out = await rankGuesses(clickerView('animal', 2), CFG);
        expect(out).toEqual(
            new Map([
                ['BEAR', 0.9],
                ['LION', 1], // clamped
                ['CAR', 0], // clamped
                ['ALIEN', 0], // non-numeric → 0
            ])
        );
    });

    it('returns null without a live clue or on failure', async () => {
        const noClue = { ...clickerView('x', 1), currentClue: null };
        expect(await rankGuesses(noClue, CFG)).toBeNull();
        mockCreate.mockRejectedValue(new Error('nope'));
        expect(await rankGuesses(clickerView('animal', 2), CFG)).toBeNull();
    });

    it('omits the count for anti-clue (0) and unlimited (-1) so scores stay pure match-strengths', async () => {
        mockCreate.mockResolvedValue(reply({ scores: { BEAR: 0.9 } }));
        await rankGuesses(clickerView('feathers', 0), CFG);
        await rankGuesses(clickerView('ocean', -1), CFG);
        for (const call of mockCreate.mock.calls) {
            const content = (call[0] as { messages: Array<{ content: string }> }).messages[0]!.content;
            expect(content).not.toMatch(/for (0|-1) card/);
        }
    });
});

describe('greedy clicker with LLM advice', () => {
    it("follows the LLM's read over backend junk and stays multi-guess informed", () => {
        const s = skill();
        // Clue the table knows nothing about: backend scores are bigram noise,
        // but the LLM read points clearly at BEAR then LION.
        const llm = {
            guessScores: new Map([
                ['BEAR', 0.9],
                ['LION', 0.7],
                ['CAR', 0.1],
                ['ALIEN', 0.05],
                ['TREE', 0.1],
            ]),
        };
        const first = makeGreedyClicker(s, tableBackend).chooseGuess(clickerView('GRIZZLY', 2), ctx(s, llm));
        expect(first).toEqual({ kind: 'reveal', index: 0 });
        // Second guess proceeds (LLM advice = informed decision, no forced bank).
        const midClue: BotClickerView = {
            ...clickerView('GRIZZLY', 2, 1),
            revealed: [true, false, false, false, false],
            types: ['red', null, null, null, null],
        };
        const second = makeGreedyClicker(s, tableBackend).chooseGuess(midClue, ctx(s, llm));
        expect(second).toEqual({ kind: 'reveal', index: 1 });
    });

    it('without advice the same unknown clue banks after one guess', () => {
        const s = skill();
        const action = makeGreedyClicker(s, tableBackend).chooseGuess(clickerView('GRIZZLY', 2, 1), ctx(s));
        expect(action).toEqual({ kind: 'endTurn' });
    });

    it('holds the +1 bonus guess to a higher floor on the hotter LLM score scale', () => {
        // Claude gives thematic fits 0.6–0.8 where the backend the floors were
        // tuned on gives 0.0–0.1 (live misses: MANUS→SHOULDER, SLEEPS→HORSE,
        // ENVIRONMENTALIST→BAT). Promise spent (number 1, one guess used):
        // the +1 needs BONUS_FLOOR_BASE + LLM_BONUS_FLOOR_BUMP now.
        const s = skill({ aggression: 1 });
        const llmOf = (top: number): BotContext['llm'] => ({
            guessScores: new Map([
                ['BEAR', top],
                ['LION', 0.1],
                ['CAR', 0.1],
                ['ALIEN', 0.05],
                ['TREE', 0.1],
            ]),
        });
        // 0.70 cleared the pre-bump floor (0.6 at full aggression) — banks now.
        expect(makeGreedyClicker(s, tableBackend).chooseGuess(clickerView('MANUS', 1, 1), ctx(s, llmOf(0.7)))).toEqual({
            kind: 'endTurn',
        });
        // A genuinely tight read still spends the +1.
        expect(makeGreedyClicker(s, tableBackend).chooseGuess(clickerView('MANUS', 1, 1), ctx(s, llmOf(0.9)))).toEqual({
            kind: 'reveal',
            index: 0,
        });
    });
});

describe('advisor with LLM advice', () => {
    it('ranks by the LLM read and drops the unknown-clue warning', () => {
        const guessScores = new Map([
            ['BEAR', 0.9],
            ['LION', 0.6],
            ['CAR', 0.05],
            ['ALIEN', 0.05],
            ['TREE', 0.05],
        ]);
        const out = suggestGuesses(clickerView('GRIZZLY', 2), tableBackend, 2, undefined, undefined, {
            guessScores,
        });
        expect(out.map((s) => s.index)).toEqual([0, 1]);
        expect(out[0]?.warning).toBeUndefined();
        expect(out[0]?.confidence).toBe(0.9);
    });
});

describe('embedding spymaster with LLM proposals', () => {
    // Synthetic backend: its own vocabulary only offers a weak single-card clue,
    // so a good proposal must win — and a dangerous one must lose — purely
    // through the standard scoring/safety machinery.
    const synthetic: SemanticBackend = {
        id: 'synthetic',
        relatedness(a: string, b: string): number {
            const key = `${a}|${b}`;
            const table: Record<string, number> = {
                // The LLM's good proposal: tight on both own cards, cold elsewhere.
                'FAUNA|BEAR': 0.9,
                'FAUNA|LION': 0.85,
                // The weak native candidate: one own card only.
                'WOODS|BEAR': 0.5,
                // The LLM's reckless proposal: hot on the assassin.
                'UFO|ALIEN': 0.95,
                'UFO|BEAR': 0.9,
                'UFO|LION': 0.9,
            };
            return table[key] ?? table[`${b}|${a}`] ?? 0;
        },
        vocabulary: () => ['WOODS'],
    };

    it('emits a strong proposal once it survives the standard gates', () => {
        const s = skill();
        const llm = { clueProposals: [{ word: 'FAUNA', number: 2, targets: ['BEAR', 'LION'] }] };
        const action = makeEmbeddingSpymaster(s, synthetic).chooseClue(spymasterView(), ctx(s, llm));
        expect(action).toEqual({ kind: 'clue', word: 'FAUNA', number: 2 });
    });

    it('never emits a proposal the assassin gate rejects, nor an illegal one', () => {
        const s = skill();
        const llm = {
            clueProposals: [
                { word: 'UFO', number: 3, targets: ['BEAR', 'LION'] }, // assassin-hot
                { word: 'ALIENS', number: 2, targets: ['BEAR'] }, // contains a board word
            ],
        };
        const action = makeEmbeddingSpymaster(s, synthetic).chooseClue(spymasterView(), ctx(s, llm));
        expect(action.kind).toBe('clue');
        const word = (action as { kind: 'clue'; word: string }).word;
        expect(word).not.toBe('UFO');
        expect(word).not.toBe('ALIENS');
    });

    it('without advice, behaves exactly as before (native candidate)', () => {
        const s = skill();
        const action = makeEmbeddingSpymaster(s, synthetic).chooseClue(spymasterView(), ctx(s));
        expect(action).toEqual({ kind: 'clue', word: 'WOODS', number: 1 });
    });
});
