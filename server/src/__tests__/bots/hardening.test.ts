/**
 * Hardening guards around the Phase 2–4 surfaces: hostile/degenerate data
 * must degrade to "no signal", never to NaN scores, event-loop stalls, or
 * unbounded state.
 */
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadSemanticMaps } from '../../bots/semantics/mapBackend';
import { makeEmbeddingSpymaster } from '../../bots/strategies/spymasters';
import { makeRng } from '../../bots/rng';
import type { EdgeKind, SemanticBackend } from '../../bots/semantics/backend';
import type { BotContext, BotSpymasterView, SkillParams } from '../../bots/strategies/types';

describe('loadSemanticMaps size guard', () => {
    let dir: string;
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'eig-maps-size-'));
        writeFileSync(
            join(dir, 'good.json'),
            JSON.stringify({ version: 1, words: ['NEBULA'], concepts: { SPACE: ['NEBULA'] } })
        );
        // Oversized file: must be skipped by stat BEFORE any parse attempt.
        writeFileSync(join(dir, 'huge.json'), Buffer.alloc(21 * 1024 * 1024, 0x20));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('skips an oversized map file and still loads the valid one', () => {
        const maps = loadSemanticMaps(dir);
        expect(maps).toHaveLength(1);
        expect(maps[0]!.words).toEqual(['NEBULA']);
    });
});

describe('scoring stays finite on degenerate edge data', () => {
    it('an unknown edge kind reads as neutral, never as NaN in the score', () => {
        // The kind is typed, but edgeInfo data crosses a JSON boundary — a
        // backend reporting a kind outside EDGE_ABSTRACTNESS must not poison
        // the candidate's score (NaN would corrupt the whole selection).
        const rel: Record<string, Record<string, number>> = {
            LINK: { OWNA: 0.9, OWNB: 0.8, OPPO: 0.02 },
        };
        const backend: SemanticBackend = {
            id: 'bogus-kind-stub',
            relatedness: (a, b) => rel[a]?.[b.toUpperCase()] ?? rel[b]?.[a.toUpperCase()] ?? 0,
            vocabulary: () => Object.keys(rel),
            edgeInfo: () => ({ strength: 0.9, kind: 'weird' as EdgeKind, penetration: 0.9 }),
        };
        const skill: SkillParams = { temperature: 0, blunderRate: 0, riskAversion: 0.6, seed: 1 };
        const ctx: BotContext = { gameMode: 'classic', skill, rng: makeRng(1) };
        const view: BotSpymasterView = {
            role: 'spymaster',
            team: 'red',
            gameMode: 'classic',
            words: ['OWNA', 'OWNB', 'OPPO'],
            revealed: [false, false, false],
            types: ['red', 'red', 'blue'],
            currentTurn: 'red',
        };
        const action = makeEmbeddingSpymaster(skill, backend).chooseClue(view, ctx);
        // A NaN score would make every comparison false and derail selection;
        // the neutral read keeps the obvious 2-clue on top.
        expect(action).toMatchObject({ kind: 'clue', word: 'LINK', number: 2 });
    });
});
