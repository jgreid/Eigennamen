/**
 * Candidate-quality filter (embeddings clue hygiene, docs/BOT_CLUE_LESSONS.md
 * Round 6). A nearest()-generated clue pool from a large model surfaces junk
 * that passes isClueLegalForBoard yet leaks or is unplayable:
 *   - cross-language cognates / orthographic near-duplicates (REVOLUCIÓN when
 *     REVOLUTION is on the board), and
 *   - wrong-language accented tokens on a board that isn't in that language.
 * isClueBoardSafe rejects both, board-derived so it stays language-agnostic.
 */
import { isClueBoardSafe, makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { makeRng } from '../../bots/rng';
import type { SemanticBackend } from '../../bots/semantics/backend';
import type { BotSpymasterView, BotContext, SkillParams } from '../../bots/strategies/types';

describe('isClueBoardSafe', () => {
    const board = ['REVOLUTION', 'WATER', 'STOCK', 'SCHOOL', 'TEACHER', 'PLANET', 'MASTER', 'STRAWBERRY', 'CAT'];

    it('rejects a cross-language cognate of a board word (the REVOLUCIÓN leak)', () => {
        expect(isClueBoardSafe('REVOLUCIÓN', board)).toBe(false);
        expect(isClueBoardSafe('REVOLUCION', board)).toBe(false); // even accent-stripped (near-dup guard)
    });

    it('catches a long same-script cognate the foreign-script guard cannot', () => {
        // ORGANISATION vs board ORGANIZATION: pure ASCII, prefix "ORGANI", one
        // edit — the near-dup guard's job (no accent for the script guard to see).
        expect(isClueBoardSafe('ORGANISATION', ['ORGANIZATION', 'WATER'])).toBe(false);
    });

    it('rejects an accented token on an all-ASCII (English) board', () => {
        expect(isClueBoardSafe('CAFÉ', board)).toBe(false);
    });

    it('does NOT reject short same-prefix look-alikes (PLANT vs PLANE, CROWD vs CROWN)', () => {
        // Orthographically one edit apart but semantically unrelated — a leak
        // filter that dropped these would strip strong, legal clues.
        expect(isClueBoardSafe('PLANT', ['PLANE', 'WATER'])).toBe(true);
        expect(isClueBoardSafe('CROWD', ['CROWN', 'WATER'])).toBe(true);
        expect(isClueBoardSafe('PLANTS', board)).toBe(true);
    });

    it('allows the same accented letters when the board itself uses them', () => {
        // A Spanish board carrying Ó keeps Ó-bearing clues (language-agnostic).
        const esBoard = ['CORAZÓN', 'AGUA', 'ESCUELA'];
        expect(isClueBoardSafe('LIMÓN', esBoard)).toBe(true);
    });

    it('does not reject short words that merely share letters (CAR vs CAT)', () => {
        expect(isClueBoardSafe('CAR', board)).toBe(true);
    });

    it('does not reject long words with a shared prefix but different word (STRAWMAN vs STRAWBERRY)', () => {
        expect(isClueBoardSafe('STRAWMAN', board)).toBe(true);
    });

    it('allows an ASCII clue using a letter absent from the board (QUARTZ)', () => {
        expect(isClueBoardSafe('QUARTZ', board)).toBe(true);
    });

    it('allows ASCII punctuation in a reference clue (apostrophe / hyphen)', () => {
        // Punctuation is not a foreign-language marker; a legitimate reference
        // clue must survive the foreign-script guard.
        expect(isClueBoardSafe("McDonald's", board)).toBe(true);
        expect(isClueBoardSafe('Spider-Man', board)).toBe(true);
    });

    it('allows ordinary safe clues', () => {
        expect(isClueBoardSafe('MAESTRO', board)).toBe(true);
        expect(isClueBoardSafe('SIGNAL', board)).toBe(true);
        expect(isClueBoardSafe('COLOUR', board)).toBe(true);
    });

    it('rejects the empty string', () => {
        expect(isClueBoardSafe('', board)).toBe(false);
    });
});

describe('spelling-variant guard (the "red flag" rule)', () => {
    // Same word in a different costume: same consonant skeleton, tiny edit
    // distance. Legal by the substring/stem letter of isClueLegalForBoard, but
    // a table argument every time — the bot simply never goes there.
    it('rejects a variant spelling of a board word', () => {
        expect(isClueBoardSafe('CREME', ['CREAM'])).toBe(false);
        expect(isClueBoardSafe('GREY', ['GRAY'])).toBe(false);
        expect(isClueBoardSafe('THEATRE', ['THEATER'])).toBe(false);
        expect(isClueBoardSafe('TEETH', ['TOOTH'])).toBe(false); // vowel-change plural
    });

    it('rejects a variant of a TOKEN of a multi-word board entry', () => {
        expect(isClueBoardSafe('CREME', ['ICE CREAM'])).toBe(false);
        expect(isClueBoardSafe('CREMES', ['ICE CREAM'])).toBe(false); // plural-folded variant
    });

    it('catches the British/American -OUR/-OR ending swap', () => {
        expect(isClueBoardSafe('COLOUR', ['COLOR'])).toBe(false);
        expect(isClueBoardSafe('FLAVOR', ['FLAVOUR'])).toBe(false);
    });

    it('keeps genuinely distinct look-alikes (different consonant skeleton)', () => {
        expect(isClueBoardSafe('GLASS', ['GRASS'])).toBe(true);
        expect(isClueBoardSafe('BEACH', ['BENCH'])).toBe(true);
        expect(isClueBoardSafe('CROWN', ['CROWD'])).toBe(true);
        expect(isClueBoardSafe('PLANE', ['PLANT'])).toBe(true);
    });

    it('keeps distinct words made by vowel INSERTION (a variant never changes length)', () => {
        expect(isClueBoardSafe('PLANT', ['PLANET'])).toBe(true);
        expect(isClueBoardSafe('PLANTS', ['PLANET'])).toBe(true);
    });

    it('keeps real clues for a multi-word entry', () => {
        expect(isClueBoardSafe('GELATO', ['ICE CREAM'])).toBe(true);
        expect(isClueBoardSafe('FROSTING', ['ICE CREAM'])).toBe(true);
        expect(isClueBoardSafe('SUNDAE', ['ICE CREAM'])).toBe(true);
    });
});

describe('generation filters cognate candidates before scoring', () => {
    function view(words: string[], types: ('red' | 'blue' | 'neutral' | 'assassin')[]): BotSpymasterView {
        return {
            role: 'spymaster',
            team: 'red',
            gameMode: 'classic',
            words,
            revealed: words.map(() => false),
            types,
            currentTurn: 'red',
        };
    }
    const skill: SkillParams = { temperature: 0, blunderRate: 0, riskAversion: 0.6, seed: 1 } as SkillParams;
    const ctx: BotContext = { gameMode: 'classic', skill, rng: makeRng(1) };

    it('a nearest() backend proposing a cognate never emits it', () => {
        const board = view(['REVOLUTION', 'OPPO', 'NEUT'], ['red', 'blue', 'neutral']);
        // The model puts a leaky cognate closest to the own card, with a clean
        // alternative just behind it. relatedness mirrors the nearest scores.
        const rel: Record<string, number> = { REVOLUCION: 0.9, UPRISING: 0.8 };
        const backend: SemanticBackend = {
            id: 'stub',
            relatedness: (a, b) => {
                const key = a.toUpperCase() === 'REVOLUTION' ? b : a;
                return rel[key.toUpperCase()] ?? 0.02;
            },
            nearest: () => [
                { word: 'REVOLUCION', score: 0.9 },
                { word: 'UPRISING', score: 0.8 },
            ],
        };
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(board, ctx);
        // The cognate is filtered out; the clean neighbour wins instead.
        expect(action.kind).toBe('clue');
        if (action.kind === 'clue') {
            expect(action.word).toBe('UPRISING');
        }
    });
});
