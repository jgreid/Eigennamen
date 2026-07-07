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
 * weak backend coverage, lethal spillover, idiosyncratic clue words, guessing
 * over-reach) so the personae and scoring weights can be tuned against real
 * numbers rather than vibes.
 *
 * The pure functions (referenceLead, aggregate, detectGaps, analyzeGames) are
 * deterministic and unit-tested; only main() touches the filesystem.
 */
import type { GameState, Team, GameMode, RevealResult } from '../../types';
import type { Entrant } from './types';
import type { SemanticBackend } from '../semantics/backend';
import { clueRetrieval } from '../semantics/backend';

import { playEngineGame, type GameEvent } from './playGame';
import { getSemanticBackend } from '../semantics/selectBackend';
import { PERSONAS } from '../personas';
import { isClueLegalForBoard } from '../../shared/gameRules';
import { makeBoardSafetyCheck } from '../strategies/clueSafety';

/** Fixed yardstick margin — a neutral, persona-independent reference so every
 *  entrant's clues are measured against the SAME theoretical ceiling. */
export const REF_MARGIN = 0.05;

/** Endgame slice: a clue given with this many own cards (or fewer) unrevealed.
 *  Both live-play assassin hits (rounds 2–3) were endgame events — spymasters
 *  relax late while guessers lower their thresholds (ledger lesson 11/18), so
 *  the danger metrics are sliced here to make that phase visible. */
export const ENDGAME_OWN_MAX = 3;

/** Candidate-pool breadth for the board-best yardstick when the backend
 *  supports nearest(); mirrors the spymaster's own centroid breadth. */
const BASELINE_NEIGHBOURS = 40;

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
    /** Board cards revealed at clue time (game progress when the clue was given). */
    revealedCount: number;
    /** Theoretical max own cards a perfect clue could safely lead (ref margin). */
    safeLead: number;
    /** Best safeLead any candidate clue could reach on this board state — the
     *  board's own ceiling, independent of the word actually chosen. 0 when the
     *  backend offers no candidate pool (no nearest() and no vocabulary()). */
    boardBestLead: number;
    /** Gap from the weakest intended own card to the best non-own card (>= 0). */
    clarity: number;
    /** The assassin was the single most clue-related unrevealed card (danger). */
    assassinArgmax: boolean;
    /** The clue's BEST non-own card is an opponent/assassin — the brightest
     *  spillover is lethal rather than a merely-wasteful neutral. */
    dangerNext: boolean;
    /** Best non-own relatedness (the clue's halo heat, 0 = perfectly cool). */
    heat: number;
    /** Frequency prior of the clue word ([0,1], 1 when the backend has none). */
    commonness: number;
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
    /** Fraction of clues whose best non-own card is an opponent/assassin — how
     *  often the brightest spillover is lethal rather than merely wasteful. */
    dangerNextRate: number;
    /** Clues given in the endgame slice (≤ ENDGAME_OWN_MAX own cards left). */
    endgameClues: number;
    /** dangerNextRate over the endgame slice only. The endgame is where both
     *  sides relax (lesson 11/18) and where live-play assassin hits landed —
     *  a spymaster should be CLEANER here, not looser. 0 when the slice is empty. */
    dangerNextRateEndgame: number;
    /** Mean board ceiling (best achievable safeLead) at this entrant's clue times. */
    avgBoardBestLead: number;
    /** sum(number) / sum(boardBestLead): how much of what the boards offered the
     *  entrant's clue numbers actually asked for. Separates timid clue SELECTION
     *  from a genuinely cold board ("we get the words we get"). 0 when the
     *  yardstick had no candidate pool. */
    ceilingUtilization: number;
    /** Avg of commonness and halo coolness (1 - heat), in [0, 1]. Low values
     *  mean idiosyncratic clues: rare words and/or hot, ambiguous halos. */
    robustness: number;
    /** Fraction of clues where the clicker banked ≥ 1 own card, pressed on, and
     *  the streak ended on a miss — a neutral, an opponent card (including
     *  handing them their game-winning last card), or the assassin. Guessing
     *  past the safe core. */
    overReachRate: number;
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

// The yardstick grades clues with the same retrieval model the clicker acts
// on (relatedness OR phrase completion, whichever is stronger) — identical to
// bare relatedness for backends without a collocation channel, so existing
// baselines are unaffected.
function maxRel(words: readonly string[], clue: string, backend: SemanticBackend): number {
    return words.length > 0 ? Math.max(...words.map((w) => clueRetrieval(backend, clue, w))) : 0;
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
): { safeLead: number; clarity: number; assassinArgmax: boolean; dangerNext: boolean; heat: number } {
    const ownRel = g.own.map((w) => clueRetrieval(backend, word, w)).sort((a, b) => b - a);
    const maxOpp = maxRel(g.opp, word, backend);
    const maxNeu = maxRel(g.neutral, word, backend);
    const maxAss = maxRel(g.assassin, word, backend);
    const maxNonOwn = Math.max(maxOpp, maxNeu, maxAss);

    let lead = 0;
    for (const r of ownRel) {
        if (r >= maxNonOwn + REF_MARGIN) lead++;
        else break;
    }
    // Assassin berth only applies while an assassin remains unrevealed — with
    // maxAss = 0 it would demand an absolute 0.1 relatedness from safe cards.
    if (g.assassin.length > 0) {
        while (lead > 0 && (ownRel[lead - 1] as number) - maxAss < REF_MARGIN * 2) lead--;
    }

    const clarity = lead > 0 ? Math.max(0, (ownRel[lead - 1] as number) - maxNonOwn) : 0;
    const maxOwn = ownRel.length > 0 ? (ownRel[0] as number) : 0;
    const assassinArgmax = g.assassin.length > 0 && maxAss >= Math.max(maxOwn, maxOpp, maxNeu);
    // The failure-mode split: a clue always spills SOMEWHERE, but spilling onto
    // an opponent/assassin card loses material while a neutral only wastes the
    // guess. dangerNext marks the former (ties count — a shared brightest
    // non-own card is one coin-flip from lethal).
    const maxDanger = Math.max(maxOpp, maxAss);
    const dangerNext = maxDanger > 0 && maxDanger >= maxNeu;
    return { safeLead: lead, clarity, assassinArgmax, dangerNext, heat: maxNonOwn };
}

/**
 * The board's own ceiling: the best safeLead ANY candidate clue reaches on this
 * board state, so an entrant's numbers can be judged against what the board
 * actually offered rather than an absolute scale (bad selection vs bad luck).
 * Candidates come from the backend's nearest() around the own cards when it has
 * one (mirroring the spymaster's generator), else its fixed vocabulary(); board
 * words are excluded by the same legality rule real clues obey — against the
 * FULL board (`allBoardWords`, revealed cards included), exactly as the server
 * validates real clues: a revealed cluster-mate is still an illegal clue, and
 * admitting it would inflate the ceiling on every post-reveal record. The
 * unrevealed-groups fallback exists only for callers with no game at hand.
 * Returns 0 when the backend offers no pool at all — consumers must treat 0 as
 * "no yardstick", not "the board offered nothing".
 */
export function boardBestLead(g: BoardGroups, backend: SemanticBackend, allBoardWords?: readonly string[]): number {
    const boardWords = allBoardWords ? [...allBoardWords] : [...g.own, ...g.opp, ...g.neutral, ...g.assassin];
    let pool: string[];
    if (backend.nearest && g.own.length > 0) {
        pool = backend.nearest(g.own, BASELINE_NEIGHBOURS).map((c) => c.word);
    } else {
        pool = backend.vocabulary ? backend.vocabulary() : [];
    }
    // The yardstick's universe must equal the player's: the spymaster's generator
    // applies makeBoardSafetyCheck (cognate / near-duplicate rejection) on top of
    // isClueLegalForBoard, so admitting candidates every entrant is forbidden to
    // play would inflate the ceiling denominator and flag spurious selection gaps
    // (G3).
    const boardSafe = makeBoardSafetyCheck(boardWords);
    let best = 0;
    for (const clue of pool) {
        if (!isClueLegalForBoard(clue, boardWords)) continue;
        if (!boardSafe(clue)) continue;
        const lead = referenceLead(clue, g, backend).safeLead;
        if (lead > best) best = lead;
        if (best >= g.own.length) break; // ceiling reached — covers everything
    }
    return best;
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
    opts: { seed: string; boardSeed?: string; gameMode: GameMode; red: Entrant; blue: Entrant; words?: string[] },
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
                revealedCount: game.revealed.reduce((n, r) => n + (r ? 1 : 0), 0),
                safeLead: ref.safeLead,
                boardBestLead: boardBestLead(groups, backend, game.words as string[]),
                clarity: ref.clarity,
                assassinArgmax: ref.assassinArgmax,
                dangerNext: ref.dangerNext,
                heat: ref.heat,
                commonness: backend.commonness?.(ev.word) ?? 1,
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
        const endgame = list.filter((r) => r.ownAvailable <= ENDGAME_OWN_MAX);
        const totalBestLead = sum((r) => r.boardBestLead);
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
            dangerNextRate: frac((r) => r.dangerNext),
            endgameClues: endgame.length,
            dangerNextRateEndgame: endgame.length > 0 ? endgame.filter((r) => r.dangerNext).length / endgame.length : 0,
            avgBoardBestLead: totalBestLead / clues,
            ceilingUtilization: totalBestLead > 0 ? totalNumber / totalBestLead : 0,
            robustness: sum((r) => (r.commonness + (1 - r.heat)) / 2) / clues,
            // A miss can occur at most once per clue (it ends the turn), so any
            // non-own reveal on a record with a banked core is the press-on that
            // failed. Checking the reveal counters — not endReason — also catches
            // the worst case: a press-on that reveals the OPPONENT's final card
            // ends the game and is recorded as 'gameWon' (by them).
            overReachRate: frac((r) => r.ownGained >= 1 && (r.oppGiven > 0 || r.neutralHit > 0 || r.assassinHit)),
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
    if (d.dangerNextRate > 0.45) {
        gaps.push('dangerous halos: > 45% of clues spill brightest onto an opponent/assassin card');
    }
    // The endgame slice gets a TIGHTER bar than the flat rate: the endgame is
    // where guessers relax their thresholds (stretch prior), so a lethal
    // brightest-spillover there converts to real hits far more often. Gated on
    // a minimum sample so a couple of unlucky late clues don't flag a persona.
    if (d.endgameClues >= 5 && d.dangerNextRateEndgame > 0.35) {
        gaps.push('endgame danger: late clues (≤3 own left) spill brightest onto an opponent/assassin card');
    }
    // Selection gap: the boards offered multi-card lines (avg ceiling ≥ 1.5) but
    // the numbers asked for well under them. Distinct from under-cluing above,
    // which compares the number to the GIVEN clue's own lead — this compares it
    // to the best clue anyone could have chosen. Skipped when the yardstick had
    // no candidate pool (avgBoardBestLead 0 ⇒ ceilingUtilization 0). Threshold
    // calibrated on live data: the yardstick applies no promise floor, so a
    // floor-respecting spymaster sits structurally below 1.0 — at 0.6 half the
    // healthy roster flagged; 0.55 keeps the flag on genuine timidity.
    if (d.avgBoardBestLead >= 1.5 && d.ceilingUtilization > 0 && d.ceilingUtilization < 0.55) {
        gaps.push('selection gap: clue choices use < 55% of the board’s best-line ceiling');
    }
    if (d.robustness < 0.6) gaps.push('idiosyncratic: clue words run rare and/or their halos run hot');
    if (d.overReachRate > 0.15) gaps.push('over-reach: > 15% of clues end with a miss past a banked core');
    return gaps;
}

/**
 * Seeds for pair (i, j)'s g-th game. The BOARD seed deliberately excludes the
 * entrant indices so every pair plays the SAME board at each board index —
 * without this, each entrant's metrics average over a private set of boards and
 * per-entrant differences conflate skill with board luck. It is derived from
 * floor(g / 2), not g: the color swap alternates on g % 2, so consecutive game
 * indices are the SAME board played once per color — otherwise board identity
 * couples to roster position (the lower-indexed entrant would hold the red key
 * of every even board in every pairing, and no pair would ever see a board from
 * both sides). The decision seed keeps the pair and full game index so the two
 * same-board games still play out differently.
 */
export function analysisSeeds(baseSeed: string, i: number, j: number, g: number): { seed: string; boardSeed: string } {
    return { seed: `${baseSeed}:${i}-${j}:${g}`, boardSeed: `${baseSeed}:board:${Math.floor(g / 2)}` };
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
                const { seed, boardSeed } = analysisSeeds(baseSeed, i, j, g);
                collectGameRecords({ seed, boardSeed, gameMode, red, blue, words }, backend, records);
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
            dangerNext: `${(d.dangerNextRate * 100).toFixed(0)}%`,
            dangerEG: `${(d.dangerNextRateEndgame * 100).toFixed(0)}%`,
            ceilUse: d.ceilingUtilization.toFixed(2),
            robust: d.robustness.toFixed(2),
            overreach: `${(d.overReachRate * 100).toFixed(0)}%`,
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
