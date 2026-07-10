/**
 * Pure engine tests: deterministic board setup, canonical rule scenarios across
 * all three modes, and rule invariants over many seeds. This is the in-suite
 * rules gate; the standalone `bots:parity` script cross-checks against real Lua.
 */
import type { GameState, GameMode } from '../../types';
import { createEngineGame, applyEngineClue, applyEngineReveal, applyEngineEndTurn } from '../../bots/engine';

function ownIndices(game: GameState, team: 'red' | 'blue'): number[] {
    const out: number[] = [];
    for (let i = 0; i < game.types.length; i++) if (game.types[i] === team && !game.revealed[i]) out.push(i);
    return out;
}

describe('createEngineGame', () => {
    it('is deterministic for the same seed', () => {
        const a = createEngineGame({ seed: 's1', gameMode: 'classic' });
        const b = createEngineGame({ seed: 's1', gameMode: 'classic' });
        expect(a.types).toEqual(b.types);
        expect(a.words).toEqual(b.words);
        expect(a.currentTurn).toBe(b.currentTurn);
    });

    it('builds a classic board with 9/8/7/1 distribution', () => {
        const g = createEngineGame({ seed: 'class', gameMode: 'classic' });
        const count = (t: string) => g.types.filter((x) => x === t).length;
        expect(count('red') + count('blue')).toBe(17);
        expect(count('neutral')).toBe(7);
        expect(count('assassin')).toBe(1);
        expect(g.redTotal + g.blueTotal).toBe(17);
    });

    it('builds a match board with card scores', () => {
        const g = createEngineGame({ seed: 'm', gameMode: 'match' });
        expect(g.cardScores).toHaveLength(25);
        expect(g.redMatchScore).toBe(0);
    });

    it('builds a duet board with dual key cards and 15 greens to find', () => {
        const g = createEngineGame({ seed: 'd', gameMode: 'duet' });
        expect(g.duetTypes).toHaveLength(25);
        expect(g.greenTotal).toBe(15);
        expect(g.timerTokens).toBeGreaterThan(0);
    });
});

describe('engine rule scenarios', () => {
    it('classic: revealing the assassin loses for the revealing team', () => {
        const g = createEngineGame({ seed: 'assassin', gameMode: 'classic' });
        const team = g.currentTurn;
        applyEngineClue(g, team, 'SIGNALX', 1);
        const assassinIndex = g.types.indexOf('assassin');
        const res = applyEngineReveal(g, assassinIndex);
        expect(res.gameOver).toBe(true);
        expect(res.endReason).toBe('assassin');
        expect(g.winner).toBe(team === 'red' ? 'blue' : 'red');
    });

    it('classic: revealing all your cards wins', () => {
        const g = createEngineGame({ seed: 'win', gameMode: 'classic' });
        const team = g.currentTurn;
        // number=0 grants unlimited guesses so this single sweep isn't interrupted
        // by a maxGuesses turn switch (which would clear currentClue mid-loop).
        applyEngineClue(g, team, 'SIGNALX', 0);
        for (const i of ownIndices(g, team)) {
            if (g.gameOver) break;
            applyEngineReveal(g, i);
        }
        expect(g.gameOver).toBe(true);
        expect(g.winner).toBe(team);
    });

    it('classic: revealing the opponent/neutral ends the turn', () => {
        const g = createEngineGame({ seed: 'switch', gameMode: 'classic' });
        const team = g.currentTurn;
        applyEngineClue(g, team, 'SIGNALX', 1);
        const neutralIndex = g.types.indexOf('neutral');
        const res = applyEngineReveal(g, neutralIndex);
        expect(res.turnEnded).toBe(true);
        expect(g.currentTurn).not.toBe(team);
    });

    it('classic: a clue of N caps guesses at N+1 (maxGuesses ends the turn)', () => {
        const g = createEngineGame({ seed: 'max', gameMode: 'classic' });
        const team = g.currentTurn;
        applyEngineClue(g, team, 'SIGNALX', 1); // 1 -> 2 guesses
        const own = ownIndices(g, team);
        applyEngineReveal(g, own[0] as number);
        const second = applyEngineReveal(g, own[1] as number);
        expect(second.turnEnded).toBe(true);
        expect(second.endReason).toBe('maxGuesses');
    });

    it('duet: revealing the assassin is a cooperative loss', () => {
        const g = createEngineGame({ seed: 'duet-a', gameMode: 'duet' });
        applyEngineClue(g, g.currentTurn, 'SIGNALX', 1);
        const assassinIndex = g.types.indexOf('assassin');
        const res = applyEngineReveal(g, assassinIndex);
        expect(res.gameOver).toBe(true);
        expect(g.winner).toBeNull();
    });

    it('match: revealing a scored card accumulates the match score', () => {
        const g = createEngineGame({ seed: 'match-score', gameMode: 'match' });
        const team = g.currentTurn;
        applyEngineClue(g, team, 'SIGNALX', 1);
        const idx = ownIndices(g, team).find((i) => (g.cardScores as number[])[i] !== 0);
        expect(idx).toBeDefined();
        const before = team === 'red' ? g.redMatchScore : g.blueMatchScore;
        applyEngineReveal(g, idx as number);
        const after = team === 'red' ? g.redMatchScore : g.blueMatchScore;
        expect((after as number) - (before as number)).toBe((g.cardScores as number[])[idx as number]);
    });

    it('endTurn switches the team and clears the clue', () => {
        const g = createEngineGame({ seed: 'et', gameMode: 'classic' });
        const team = g.currentTurn;
        applyEngineClue(g, team, 'SIGNALX', 2);
        const res = applyEngineEndTurn(g);
        expect(res.currentTurn).not.toBe(team);
        expect(g.currentClue).toBeNull();
        expect(g.guessesAllowed).toBe(0);
    });
});

describe('applyEngineClue clamps like submitClue.lua (N23)', () => {
    // These pin the engine's clamp to submitClue.lua's constants (CLUE_NUMBER_MAX=9,
    // nil/negative→0, truncate) — the Lua clamp itself is covered directly by
    // __tests__/integration/luaScripts.test.ts. The parity harness can't drive
    // >9 because gameService.submitClue's Zod shape check rejects it before Lua.
    it('clamps a number above CLUE_NUMBER_MAX to 9 in the clue, history, and guess budget', () => {
        const g = createEngineGame({ seed: 'clamp-hi', gameMode: 'classic' });
        const res = applyEngineClue(g, g.currentTurn, 'SIGNALX', 12);
        expect(res.number).toBe(9);
        expect(res.guessesAllowed).toBe(10); // 9 + 1
        expect(g.currentClue?.number).toBe(9);
        expect(g.guessesAllowed).toBe(10);
        const last = g.history?.[g.history.length - 1] as { action: string; number: number };
        expect(last).toMatchObject({ action: 'clue', number: 9 });
    });

    it('clamps a negative number to 0 (unlimited guesses)', () => {
        const g = createEngineGame({ seed: 'clamp-neg', gameMode: 'classic' });
        const res = applyEngineClue(g, g.currentTurn, 'SIGNALX', -5);
        expect(res.number).toBe(0);
        expect(res.guessesAllowed).toBe(0); // 0 = unlimited
        expect(g.currentClue?.number).toBe(0);
    });

    it('truncates a fractional number toward zero', () => {
        const g = createEngineGame({ seed: 'clamp-frac', gameMode: 'classic' });
        const res = applyEngineClue(g, g.currentTurn, 'SIGNALX', 3.7);
        expect(res.number).toBe(3);
        expect(res.guessesAllowed).toBe(4);
        expect(g.currentClue?.number).toBe(3);
    });

    it('accepts an exactly-at-cap number unchanged', () => {
        const g = createEngineGame({ seed: 'clamp-at', gameMode: 'classic' });
        const res = applyEngineClue(g, g.currentTurn, 'SIGNALX', 9);
        expect(res.number).toBe(9);
        expect(res.guessesAllowed).toBe(10);
    });
});

describe('engine caps history like the Lua ops (N23)', () => {
    it('trims game.history to MAX_HISTORY_ENTRIES (200), keeping the most recent', () => {
        // Drive many clue/endTurn cycles so history would exceed the cap without
        // trimming. Each cycle pushes a clue + an endTurn entry (2 per loop).
        const g = createEngineGame({ seed: 'hist-cap', gameMode: 'classic' });
        for (let i = 0; i < 300; i++) {
            applyEngineClue(g, g.currentTurn, 'SIGNALX', 0);
            applyEngineEndTurn(g);
        }
        expect(g.history?.length).toBe(200);
        // The tail (most recent) is retained: the very last entry is an endTurn.
        const last = g.history?.[g.history.length - 1] as { action: string };
        expect(last.action).toBe('endTurn');
    });
});

describe('engine rule invariants (many seeds, all modes)', () => {
    const modes: GameMode[] = ['classic', 'duet', 'match'];
    for (const mode of modes) {
        it(`${mode}: games terminate and scores stay consistent`, () => {
            for (let s = 0; s < 300; s++) {
                const g = createEngineGame({ seed: `inv:${mode}:${s}`, gameMode: mode });
                let reveals = 0;
                let guard = 0;
                while (!g.gameOver && guard++ < 200) {
                    // Deterministic policy: reveal the lowest unrevealed index.
                    const idx = g.revealed.findIndex((r) => !r);
                    if (idx < 0) break;
                    // A real turn always starts with a clue; number=0 grants
                    // unlimited guesses so this naive policy can freely reveal
                    // until the turn ends on its own (assassin/opponent/neutral).
                    if (!g.currentClue) {
                        applyEngineClue(g, g.currentTurn, 'X', 0);
                    }
                    applyEngineReveal(g, idx);
                    reveals++;
                }
                expect(g.gameOver).toBe(true);
                expect(g.revealed.filter(Boolean).length).toBe(reveals);
                expect(g.redScore).toBeLessThanOrEqual(g.redTotal);
                expect(g.blueScore).toBeLessThanOrEqual(g.blueTotal);

                if (mode === 'match' && g.cardScores && g.revealedBy) {
                    let red = 0;
                    let blue = 0;
                    for (let i = 0; i < 25; i++) {
                        if (g.revealedBy[i] === 'red') red += g.cardScores[i] as number;
                        else if (g.revealedBy[i] === 'blue') blue += g.cardScores[i] as number;
                    }
                    expect(g.redMatchScore).toBe(red);
                    expect(g.blueMatchScore).toBe(blue);
                }
                if (mode === 'duet') {
                    expect(g.greenFound as number).toBeLessThanOrEqual(g.greenTotal as number);
                    if (g.winner === 'red') expect(g.greenFound).toBe(g.greenTotal);
                }
            }
        });
    }
});
