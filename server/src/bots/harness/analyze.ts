/**
 * Clue-giving diagnostics harness (`npm run bots:analyze`).
 *
 * The self-play tournament (runMatches.ts) tells you WHO wins. This tells you
 * WHY a spymaster's clues are weak — it instruments games via the playEngineGame
 * `onEvent` hook, reconstructs each clue's outcome (how many own cards it landed,
 * whether it leaked to the opponent, misfired on a neutral, or grazed the
 * assassin), and compares the clue number the bot actually gave against the
 * board's theoretical safe ceiling. Aggregated per entrant, it surfaces concrete
 * clue-strategy GAPS (under-cluing, poor delivery, leakiness, assassin exposure,
 * weak backend coverage) so the personae and scoring weights can be tuned against
 * real numbers rather than vibes.
 *
 * The pure functions (referenceLead, aggregate, detectGaps, analyzeGames) are
 * deterministic and unit-tested; only main() touches the filesystem.
 */
import type { GameState, Team, GameMode, RevealResult } from '../../types';
import type { Entrant } from './types';
import type { SemanticBackend } from '../semantics/backend';

import { playEngineGame, type GameEvent } from './playGame';
import { getSemanticBackend } from '../semantics/selectBackend';
import { PERSONAS } from '../personas';

/** Fixed yardstick margin — a neutral, persona-independent reference so every
 *  entrant's clues are measured against the SAME theoretical ceiling. */
export const REF_MARGIN = 0.05;

/** Unrevealed board words split by their relationship to the clue-giving team. */
export interface BoardGroups {
    own: string[];
    opp: string[];
    neutral: string[];
    assassin: string[];
}

/** How a clue's guessing phase ended. */
export type ClueEnd = 'exhausted' | 'wrongGuess' | 'assassin' | 'voluntaryStop' | 'gameWon' | 'openTurn';

/** One clue and everything that followed it, as observed in a game. */
export interface ClueRecord {
    entrantId: string;
    team: Team;
    word: string;
    number: number;
    /** Own cards unrevealed at clue time. */
    ownAvailable: number;
    /** Theoretical max own cards a perfect clue could safely lead (ref margin). */
    safeLead: number;
    /** Gap from the weakest intended own card to the best non-own card (>= 0). */
    clarity: number;
    /** The assassin was the single most clue-related unrevealed card (danger). */
    assassinArgmax: boolean;
    /** No own card led safely — the spymaster fell back to a best-effort clue. */
    fallback: boolean;
    ownGained: number;
    oppGiven: number;
    neutralHit: number;
    assassinHit: boolean;
    reveals: number;
    endReason: ClueEnd;
}

/** Per-entrant aggregate diagnostics + human-readable gap flags. */
export interface ClueDiagnostics {
    entrantId: string;
    clues: number;
    avgNumber: number;
    /** Counts of clue numbers, bucketed 1 / 2 / 3 / 4+. */
    numberHistogram: Record<'1' | '2' | '3' | '4+', number>;
    avgOwnGained: number;
    /** sum(ownGained) / sum(number): how fully clues actually land, in [0, ~1]. */
    deliveryRate: number;
    avgSafeLead: number;
    /** avgNumber / avgSafeLead: 1 = clues match the board's safe ceiling. */
    ambition: number;
    misfireRate: number;
    leakRate: number;
    assassinRate: number;
    fallbackRate: number;
    wrongGuessRate: number;
    gaps: string[];
}

export interface AnalyzeSpec {
    entrants: Entrant[];
    gameMode: GameMode;
    /** Games per unordered entrant pair (colors alternate for fairness). */
    gamesPerPair: number;
    baseSeed: string;
    words?: string[];
    /** Backend used for the theoretical yardstick (defaults to the configured one). */
    backend?: SemanticBackend;
}

export interface AnalyzeReport {
    records: ClueRecord[];
    diagnostics: ClueDiagnostics[];
}

function maxRel(words: readonly string[], clue: string, backend: SemanticBackend): number {
    return words.length > 0 ? Math.max(...words.map((w) => backend.relatedness(clue, w))) : 0;
}

/**
 * Split the unrevealed board into own / opponent / neutral / assassin from the
 * clue-giving team's perspective. Mirrors the spymaster's own view: in Duet the
 * blue side reads its own key card (duetTypes) and has no "opponent" cards.
 */
export function boardGroupsFor(game: GameState, team: Team): BoardGroups {
    const isDuet = game.gameMode === 'duet';
    const types = isDuet && team === 'blue' ? (game.duetTypes ?? game.types) : game.types;
    const other = team === 'red' ? 'blue' : 'red';
    const g: BoardGroups = { own: [], opp: [], neutral: [], assassin: [] };
    for (let i = 0; i < types.length; i++) {
        if (game.revealed[i]) continue;
        const w = game.words[i] as string;
        const t = types[i];
        if (t === team) g.own.push(w);
        else if (t === 'assassin') g.assassin.push(w);
        else if (!isDuet && t === other) g.opp.push(w);
        else g.neutral.push(w);
    }
    return g;
}

/**
 * The theoretical yardstick for a clue on a board: how many own cards a perfect
 * clicker could safely take (safeLead), the clarity gap to the best non-own card,
 * and whether the assassin is the most-related card of all (a dangerous board /
 * clue combination). Uses the fixed REF_MARGIN so every entrant is judged alike.
 */
export function referenceLead(
    word: string,
    g: BoardGroups,
    backend: SemanticBackend
): { safeLead: number; clarity: number; assassinArgmax: boolean } {
    const ownRel = g.own.map((w) => backend.relatedness(word, w)).sort((a, b) => b - a);
    const maxOpp = maxRel(g.opp, word, backend);
    const maxNeu = maxRel(g.neutral, word, backend);
    const maxAss = maxRel(g.assassin, word, backend);
    const maxNonOwn = Math.max(maxOpp, maxNeu, maxAss);

    let lead = 0;
    for (const r of ownRel) {
        if (r >= maxNonOwn + REF_MARGIN) lead++;
        else break;
    }
    while (lead > 0 && (ownRel[lead - 1] as number) - maxAss < REF_MARGIN * 2) lead--;

    const clarity = lead > 0 ? Math.max(0, (ownRel[lead - 1] as number) - maxNonOwn) : 0;
    const maxOwn = ownRel.length > 0 ? (ownRel[0] as number) : 0;
    const assassinArgmax = g.assassin.length > 0 && maxAss >= Math.max(maxOwn, maxOpp, maxNeu);
    return { safeLead: lead, clarity, assassinArgmax };
}

/** Reduce a terminal reveal into the reason a clue's guessing phase ended. */
function endReasonFor(result: RevealResult, team: Team): ClueEnd | null {
    if (result.gameOver) return result.endReason === 'assassin' ? 'assassin' : 'gameWon';
    if (!result.turnEnded) return null; // correct own card, turn continues
    if (result.endReason === 'maxGuesses') return 'exhausted';
    return result.type === team ? 'exhausted' : 'wrongGuess';
}

/**
 * Play one instrumented game and append its clue records. `redId`/`blueId` tag
 * each clue with the entrant that gave it so records can be pooled across games.
 */
function collectGameRecords(
    opts: { seed: string; gameMode: GameMode; red: Entrant; blue: Entrant; words?: string[] },
    backend: SemanticBackend,
    sink: ClueRecord[]
): void {
    let active: ClueRecord | null = null;
    const finalize = (reason: ClueEnd): void => {
        if (!active) return;
        active.endReason = reason;
        sink.push(active);
        active = null;
    };

    const onEvent = (ev: GameEvent, game: GameState): void => {
        if (ev.kind === 'clue') {
            finalize('openTurn'); // defensive: a prior clue with no terminal reveal
            const groups = boardGroupsFor(game, ev.team);
            const ref = referenceLead(ev.word, groups, backend);
            active = {
                entrantId: ev.team === 'red' ? opts.red.id : opts.blue.id,
                team: ev.team,
                word: ev.word,
                number: ev.number,
                ownAvailable: groups.own.length,
                safeLead: ref.safeLead,
                clarity: ref.clarity,
                assassinArgmax: ref.assassinArgmax,
                fallback: ref.safeLead === 0,
                ownGained: 0,
                oppGiven: 0,
                neutralHit: 0,
                assassinHit: false,
                reveals: 0,
                endReason: 'openTurn',
            };
        } else if (ev.kind === 'reveal' && active) {
            active.reveals++;
            const t = ev.result.type;
            if (t === ev.team) active.ownGained++;
            else if (t === 'assassin') active.assassinHit = true;
            else if (t === 'red' || t === 'blue') active.oppGiven++;
            else active.neutralHit++;
            const reason = endReasonFor(ev.result, ev.team);
            if (reason) finalize(reason);
        } else if (ev.kind === 'endTurn') {
            finalize('voluntaryStop');
        }
    };

    playEngineGame({ ...opts, onEvent });
    finalize('openTurn');
}

const bucket = (n: number): '1' | '2' | '3' | '4+' => (n >= 4 ? '4+' : (String(n) as '1' | '2' | '3'));

/** Aggregate raw clue records into per-entrant diagnostics with gap flags. */
export function aggregate(records: ClueRecord[]): ClueDiagnostics[] {
    const byEntrant = new Map<string, ClueRecord[]>();
    for (const r of records) {
        const list = byEntrant.get(r.entrantId) ?? [];
        list.push(r);
        byEntrant.set(r.entrantId, list);
    }

    const out: ClueDiagnostics[] = [];
    for (const [entrantId, list] of byEntrant) {
        const clues = list.length;
        const sum = (f: (r: ClueRecord) => number): number => list.reduce((s, r) => s + f(r), 0);
        const frac = (f: (r: ClueRecord) => boolean): number => list.filter(f).length / clues;

        const histogram: Record<'1' | '2' | '3' | '4+', number> = { '1': 0, '2': 0, '3': 0, '4+': 0 };
        for (const r of list) histogram[bucket(r.number)]++;

        const totalNumber = sum((r) => r.number);
        const avgNumber = totalNumber / clues;
        const avgSafeLead = sum((r) => r.safeLead) / clues;
        const d: ClueDiagnostics = {
            entrantId,
            clues,
            avgNumber,
            numberHistogram: histogram,
            avgOwnGained: sum((r) => r.ownGained) / clues,
            deliveryRate: totalNumber > 0 ? sum((r) => r.ownGained) / totalNumber : 0,
            avgSafeLead,
            ambition: avgSafeLead > 0 ? avgNumber / avgSafeLead : 0,
            misfireRate: frac((r) => r.neutralHit > 0),
            leakRate: frac((r) => r.oppGiven > 0),
            assassinRate: frac((r) => r.assassinHit),
            fallbackRate: frac((r) => r.fallback),
            wrongGuessRate: frac((r) => r.endReason === 'wrongGuess'),
            gaps: [],
        };
        d.gaps = detectGaps(d);
        out.push(d);
    }
    out.sort((a, b) => a.entrantId.localeCompare(b.entrantId));
    return out;
}

/** Threshold-based gap detection — turns the aggregates into actionable flags. */
export function detectGaps(d: ClueDiagnostics): string[] {
    const gaps: string[] = [];
    // Under-cluing is only a GAP when the board could safely support bigger
    // numbers (ambition < 0.8) — a low average against a coarse backend whose own
    // safe ceiling is ~1 is clueing AT the ceiling, not timidity, so it's not flagged.
    if (d.avgNumber < 1.4 && d.ambition < 0.8) {
        gaps.push('under-cluing: numbers sit below the board’s safe ceiling');
    }
    if (d.deliveryRate < 0.55) gaps.push('poor delivery: clicker takes < 55% of intended cards');
    if (d.leakRate > 0.18) gaps.push('leaky: > 18% of clues also point at the opponent');
    if (d.misfireRate > 0.4) gaps.push('imprecise: > 40% of clues misfire on a neutral');
    if (d.assassinRate > 0.02) gaps.push('assassin exposure: hits the assassin > 2% of clues');
    if (d.fallbackRate > 0.25) gaps.push('weak coverage: > 25% of clues have no safe lead (OOV/best-effort)');
    if (d.wrongGuessRate > 0.35) gaps.push('high wrong-guess rate: turns end early on a bad guess');
    return gaps;
}

/** Round-robin analysis over the entrants; returns raw records + diagnostics. */
export function analyzeGames(spec: AnalyzeSpec): AnalyzeReport {
    const backend = spec.backend ?? getSemanticBackend();
    const records: ClueRecord[] = [];
    const { entrants, gameMode, gamesPerPair, baseSeed, words } = spec;

    for (let i = 0; i < entrants.length; i++) {
        for (let j = i + 1; j < entrants.length; j++) {
            for (let g = 0; g < gamesPerPair; g++) {
                const swap = g % 2 === 1;
                const red = (swap ? entrants[j] : entrants[i]) as Entrant;
                const blue = (swap ? entrants[i] : entrants[j]) as Entrant;
                const seed = `${baseSeed}:${i}-${j}:${g}`;
                collectGameRecords({ seed, gameMode, red, blue, words }, backend, records);
            }
        }
    }

    return { records, diagnostics: aggregate(records) };
}

/** Default roster: every persona as a semantic spymaster, read by an expert clicker. */
export function personaEntrants(): Entrant[] {
    return PERSONAS.map((p) => ({
        id: p.id,
        spymaster: { strategyId: 'embeddingSpymaster', skillPreset: p.id },
        clicker: { strategyId: 'greedyClicker', skillPreset: 'expert' },
    }));
}

/* istanbul ignore next -- CLI entry, exercised manually via `npm run bots:analyze` */
async function main(): Promise<void> {
    const fs = await import('fs');
    const path = await import('path');

    const argv = process.argv.slice(2);
    const arg = (flag: string, def: string): string => {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? (argv[i + 1] as string) : def;
    };

    const spec: AnalyzeSpec = {
        entrants: personaEntrants(),
        gameMode: arg('--mode', 'classic') as GameMode,
        gamesPerPair: parseInt(arg('--games', '60'), 10),
        baseSeed: arg('--seed', 'analyze'),
    };

    const { records, diagnostics } = analyzeGames(spec);

    const outDir = path.resolve(__dirname, '..', 'results');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `analysis-${stamp}.json`), JSON.stringify(diagnostics, null, 2));

    // eslint-disable-next-line no-console
    console.log(`\n${spec.gameMode} — ${records.length} clues across ${spec.entrants.length} personae\n`);
    // eslint-disable-next-line no-console
    console.table(
        diagnostics.map((d) => ({
            persona: d.entrantId,
            clues: d.clues,
            avgNum: d.avgNumber.toFixed(2),
            'nums(1/2/3/4+)': `${d.numberHistogram['1']}/${d.numberHistogram['2']}/${d.numberHistogram['3']}/${d.numberHistogram['4+']}`,
            delivery: `${(d.deliveryRate * 100).toFixed(0)}%`,
            ambition: d.ambition.toFixed(2),
            leak: `${(d.leakRate * 100).toFixed(0)}%`,
            misfire: `${(d.misfireRate * 100).toFixed(0)}%`,
            assassin: `${(d.assassinRate * 100).toFixed(1)}%`,
            fallback: `${(d.fallbackRate * 100).toFixed(0)}%`,
        }))
    );

    // eslint-disable-next-line no-console
    console.log('\nGaps:');
    for (const d of diagnostics) {
        // eslint-disable-next-line no-console
        console.log(`  ${d.entrantId}: ${d.gaps.length > 0 ? d.gaps.join('; ') : 'none flagged ✓'}`);
    }
}

/* istanbul ignore next */
if (require.main === module) {
    main().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(err);
        process.exit(1);
    });
}
