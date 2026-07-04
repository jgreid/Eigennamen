/**
 * Proper-noun (pop-culture) associations — the "capital-A Alien" table.
 *
 * House-rule convention this implements: the CASE of a clue word carries
 * meaning. A mixed-case clue ("Alien", "iPhone") denotes the specific proper
 * noun — the film, the product, the character — while an all-lowercase clue
 * ("alien") explicitly denotes the common-noun sense. Legacy ALL-CAPS clues
 * carry no signal and are read both ways. This gives spymasters far more
 * granular clues ("Cinderella" bundles GLASS + PRINCESS + BALL in one image)
 * at the cost of a trap the fame ratings below guard against: a reference is
 * only a good clue if the guessers actually know it.
 *
 * Curation rules:
 *  - Keys are stored in their DISPLAY case ("Cinderella", "iPhone", "UFO") —
 *    the spymaster emits them verbatim, which is itself the signal.
 *  - Every target MUST be a word from the default board list (guarded by a
 *    test); the table is useless for words that never appear on a board.
 *  - A key may collide with a board word — as a substring ("Rocky" vs ROCK)
 *    or even exactly ("Alien" vs ALIEN, which is in the default pool):
 *    isClueLegalForBoard rejects it on exactly the boards where the colliding
 *    word was drawn, so such keys simply don't fire there — never list the
 *    colliding word itself as a target (it would only be reachable when
 *    illegal).
 *  - FAME rates how widely known the reference is (1 = everyone knows it).
 *    It feeds SemanticBackend.commonness(), so the spymaster's rarity penalty
 *    (scaled by the persona's commonnessBias) naturally implements "only clue
 *    culture references the guessers are going to know": a Sharpshooter
 *    (commonnessBias 1.5) sticks to the household names, a Maverick (0.4)
 *    happily reaches for the deep cuts.
 *  - CONTENTS must be exhaustive at the referent level, not the curator's
 *    recall level (Phase 3, ledger lessons 10/19 — "the referent knows more
 *    than you"): a title clue collides with its OWN board-resident contents
 *    (Thunderball's POOL and CASINO) and with brand/product tiers (Tinder's
 *    GOLD) at scoring time, but only if the edges exist. Weight an edge below
 *    1 when it pulls real but second-tier retrieval.
 *  - PROPER_RIVALS lists other referents the same clue word evokes; their
 *    contents pull guesses too, scaled by the rival's fame ("Apollo" reaches
 *    FIGHTER through Apollo Creed even when the cluer meant the moon program).
 *  - PROPER_HYPERNYMS lists type-level readings (Thunderball IS a novel and a
 *    film), scored below content matches — exemplar→type retrieval is real
 *    but weak (ledger lesson 7, the exemplar asymmetry).
 */
import type { AssociationTarget } from './associationIndex';

/** Proper-noun reference → board words it evokes (weight 1 unless curated
 *  lower). Keys in display case. */
export const PROPER_ASSOCIATIONS: Record<string, AssociationTarget[]> = {
    // Film & TV
    Alien: ['SPACE', 'SHIP', 'ROBOT', 'SCIENTIST'],
    Avatar: ['ALIEN', 'FILM', 'FOREST'],
    Batman: ['KNIGHT', 'SUPERHERO', 'SHADOW'],
    Bollywood: ['FILM', 'INDIA', 'DANCE'],
    Cinderella: ['GLASS', 'PRINCESS', 'BALL'],
    Disney: ['MOUSE', 'PRINCESS', 'FILM'],
    Dracula: ['BAT', 'NIGHT', 'DEATH'],
    ET: ['ALIEN', 'MOON', 'KID'],
    Frankenstein: ['BOLT', 'SCIENTIST', 'LAB'],
    Frozen: ['ICE', 'SNOW', 'SNOWMAN', 'PRINCESS', 'QUEEN'],
    Godzilla: ['DINOSAUR', 'TOKYO', 'GIANT'],
    Gotham: ['BAT', 'NIGHT', 'SUPERHERO'],
    Halloween: ['WITCH', 'GHOST', 'PUMPKIN', 'NIGHT'],
    Hogwarts: ['WITCH', 'SPELL', 'SCHOOL', 'DRAGON', 'GHOST'],
    Jaws: ['SHARK', 'BEACH', 'FISH', 'WATER'],
    Jedi: ['FORCE', 'KNIGHT', 'SPACE'],
    Kong: ['GIANT', 'SKYSCRAPER'],
    Krypton: ['SUPERHERO', 'SPACE'],
    Matrix: ['CODE', 'AGENT', 'ROBOT'],
    Moby: ['WHALE', 'SHIP'],
    Mulan: ['CHINA', 'SOLDIER', 'PRINCESS'],
    Nemo: ['FISH', 'SHARK', 'WATER'],
    Pixar: ['FILM', 'ROBOT', 'FISH'],
    Rocky: ['FIGHTER', 'RING'],
    Sherlock: ['PIPE', 'LONDON', 'DOCTOR'],
    Shrek: ['GREEN', 'DRAGON', 'PRINCESS'],
    Spiderman: ['WEB', 'SUPERHERO'],
    Superman: ['SUPERHERO', 'FLY'],
    Terminator: ['ROBOT', 'TIME'],
    Titanic: ['SHIP', 'ICE', 'DIAMOND', 'WATER'],
    Vader: ['FORCE', 'DEATH', 'SPACE'],
    Wonka: ['CHOCOLATE', 'GOLD'],

    // Stories, myth & legend
    Camelot: ['KING', 'KNIGHT', 'COURT'],
    Excalibur: ['KING', 'KNIGHT'],
    Hercules: ['LION', 'GREECE'],
    Hobbit: ['DWARF', 'DRAGON', 'RING'],
    Merlin: ['SPELL', 'KING', 'KNIGHT'],
    Neverland: ['HOOK', 'PIRATE', 'FLY', 'KID'],
    Poseidon: ['WATER', 'GREECE'],
    Rapunzel: ['PRINCESS', 'TOWER'],
    Trojan: ['HORSE', 'WAR', 'GREECE'],
    Zeus: ['GREECE', 'BOLT', 'KING'],

    // Acronyms & intercaps — canonical case IS the reference ("case matters
    // for each letter"): NASA/CIA carry the proper signal in ALL CAPS because
    // that is their canonical form; McDonald's carries it via the intercap.
    CIA: ['AGENT', 'SPY', 'CODE', 'WASHINGTON'],
    DNA: ['CODE', 'CELL', 'LAB'],
    FBI: ['AGENT', 'SPY', 'WASHINGTON'],
    KGB: ['SPY', 'AGENT', 'MOSCOW'],
    "McDonald's": ['KID', 'GOLD'],
    NBA: ['BALL', 'COURT', 'STAR'],
    USA: ['AMERICA', 'WASHINGTON'],
    USSR: ['MOSCOW', 'REVOLUTION'],

    // Games & tech
    iPhone: ['APPLE', 'SCREEN', 'TABLET'],
    Lego: ['BLOCK', 'PLASTIC'],
    Mario: ['PIPE', 'PRINCESS', 'STAR'],
    Minecraft: ['BLOCK', 'DIAMOND'],
    Pikachu: ['MOUSE', 'BOLT'],
    Pokemon: ['MOUSE', 'BALL'],
    Tetris: ['BLOCK', 'SQUARE', 'LINE'],
    Zelda: ['LINK', 'PRINCESS'],

    // Ledger round 2–3 references (the live-play misfires, curated to spec:
    // exhaustive contents including scenes and brand tiers). Note the key
    // collisions are deliberate and legal-checked per the rules above:
    // "Thunderball" ⊃ BALL, "GoldenEye" ⊃ GOLD/EYE, "Hooke" ⊃ HOOK — those
    // clues simply can't fire on boards carrying the colliding word.
    GoldenEye: ['SATELLITE', 'AGENT', { word: 'RAY', weight: 0.6 }],
    Hooke: ['SPRING', 'FORCE'],
    Thunderball: [
        { word: 'POOL', weight: 0.7 },
        { word: 'CASINO', weight: 0.7 },
        { word: 'SHARK', weight: 0.6 },
    ],
    Tinder: ['DATE', 'MATCH', { word: 'GOLD', weight: 0.5 }],

    // People & music
    Beatles: ['BAND', 'ENGLAND', 'LONDON'],
    Beethoven: ['PIANO', 'CONCERT', 'NOTE'],
    Caesar: ['ROME', 'KING'],
    Cleopatra: ['EGYPT', 'QUEEN', 'PYRAMID'],
    Einstein: ['GENIUS', 'SCIENTIST'],
    Elvis: ['KING', 'ROCK', 'STAR'],
    Houdini: ['LOCK', 'SPELL'],
    Jordan: ['AIR', 'BALL', 'STAR'],
    Mozart: ['PIANO', 'OPERA', 'CONCERT', 'NOTE'],
    Napoleon: ['FRANCE', 'WAR', 'REVOLUTION'],
    Newton: ['APPLE', 'SCIENTIST', 'GENIUS'],

    // Places, events & things
    Apollo: ['MOON', 'SPACE', 'GREECE'],
    Broadway: ['PLAY', 'NEW YORK', 'DANCE'],
    Christmas: ['ANGEL', 'BELL', 'SNOWMAN', 'STAR'],
    Easter: ['RABBIT', 'CHURCH'],
    Eiffel: ['TOWER', 'FRANCE'],
    Everest: ['MOUNT', 'HIMALAYAS', 'SNOW'],
    Ferrari: ['CAR', 'HORSE'],
    Liberty: ['TORCH', 'NEW YORK', 'CROWN'],
    Mars: ['SPACE', 'WAR', 'CHOCOLATE'],
    NASA: ['SPACE', 'MOON', 'SATELLITE'],
    Neptune: ['WATER', 'SPACE'],
    Nike: ['SHOE', 'GREECE'],
    Nile: ['EGYPT', 'WATER'],
    Olympics: ['GAME', 'GOLD', 'GREECE', 'TORCH'],
    Pompeii: ['VOLCANO', 'ROME'],
    Roswell: ['ALIEN', 'SPACE'],
    Sparta: ['WAR', 'GREECE', 'SOLDIER'],
    Sputnik: ['SATELLITE', 'SPACE', 'MOSCOW'],
    Thanksgiving: ['TURKEY', 'FALL'],
    Thor: ['SUPERHERO', 'BOLT'],
    UFO: ['ALIEN', 'SPACE', 'FLY'],
    Vegas: ['CASINO', 'ROULETTE', 'DICE'],
    Viking: ['SHIP', 'HORN'],
    Wimbledon: ['RACKET', 'GRASS', 'ENGLAND'],
};

/**
 * Rival referents (Phase 3, ledger lesson 10 — referent collision): other
 * things the same clue word evokes, whose contents pull guesses scaled by the
 * rival's fame. The spymaster's ordinary margin machinery then sees the pull:
 * "Apollo" meant for MOON+SPACE still lights up FIGHTER for every guesser who
 * lands on Apollo Creed first. Rival contents obey the same board-word and
 * substring-collision rules as the main table.
 */
export interface RivalReferent {
    referent: string;
    /** How widely known the rival is, in (0, 1] — scales its contents' pull. */
    fame: number;
    contents: AssociationTarget[];
}

export const PROPER_RIVALS: Record<string, RivalReferent[]> = {
    Apollo: [{ referent: 'Apollo Creed (Rocky)', fame: 0.6, contents: ['FIGHTER', 'RING'] }],
    Elvis: [{ referent: 'Elvis (2022 film)', fame: 0.4, contents: ['FILM'] }],
    Zelda: [{ referent: 'Zelda Fitzgerald', fame: 0.3, contents: ['NOVEL'] }],
};

/**
 * Type-level readings of a reference (Phase 3, ledger lesson 7 — the exemplar
 * asymmetry): "Thunderball" IS a novel and a film, and a guesser who can't
 * retrieve the contents still reaches the type. Scored below content matches
 * (HYPERNYM_SCORE in tableBackend) — exemplar→type retrieval is real but
 * weak, the reverse of how a type clue retrieves its exemplars.
 */
export const PROPER_HYPERNYMS: Record<string, string[]> = {
    Alien: ['FILM'],
    Dracula: ['NOVEL', 'FILM'],
    Frankenstein: ['NOVEL'],
    GoldenEye: ['FILM'],
    Hooke: ['SCIENTIST'],
    Moby: ['NOVEL'],
    Sherlock: ['NOVEL'],
    Thunderball: ['NOVEL', 'FILM'],
    Titanic: ['FILM'],
};

/** Everyone-knows-it default; override below for the deeper cuts. */
export const DEFAULT_PROPER_FAME = 0.9;

/** How widely known each reference is, in (0, 1]. Only exceptions listed. */
export const PROPER_FAME: Record<string, number> = {
    Bollywood: 0.75,
    Camelot: 0.7,
    GoldenEye: 0.7,
    // The round-3 calibration lesson in one number: knowing who Hooke is AT
    // ALL is a deep cut for a median table, however bright the spring/force
    // edges burn for a physicist.
    Hooke: 0.35,
    Thunderball: 0.65,
    Tinder: 0.85,
    KGB: 0.8,
    USSR: 0.8,
    Excalibur: 0.75,
    Gotham: 0.75,
    Hercules: 0.8,
    Houdini: 0.75,
    Jordan: 0.85,
    Kong: 0.85,
    Krypton: 0.75,
    Merlin: 0.75,
    Moby: 0.8,
    Neptune: 0.75,
    Pixar: 0.8,
    Pompeii: 0.75,
    Poseidon: 0.7,
    Roswell: 0.65,
    Sparta: 0.8,
    Sputnik: 0.7,
    Trojan: 0.8,
    Viking: 0.85,
    Wimbledon: 0.7,
    Zelda: 0.7,
};

/**
 * The case-signal a word carries under the house-rule convention:
 *  - 'proper': mixed case ("Alien", "iPhone") — the specific reference.
 *  - 'common': all lowercase ("alien") — explicitly the common-noun sense.
 *  - 'neutral': no lowercase letters (ALL CAPS, digits, legacy clients,
 *    board words) — no signal; read it both ways.
 */
export type CaseSignal = 'proper' | 'common' | 'neutral';

export function caseSignal(word: string): CaseSignal {
    const hasLower = /\p{Ll}/u.test(word);
    if (!hasLower) return 'neutral';
    return /\p{Lu}/u.test(word) ? 'proper' : 'common';
}

/** Exact-case key set — "case matters for each letter". */
const CANONICAL_KEYS = new Set(Object.keys(PROPER_ASSOCIATIONS));

/**
 * The case-signal a CLUE carries, including canonical-form matching: an
 * ALL-CAPS clue that letter-for-letter matches a reference whose canonical
 * form IS all caps ("NASA", "CIA", "UFO") carries the proper signal — an
 * acronym has no lowercase letters to signal with, so its exact canonical
 * case is the signal. Any other ALL-CAPS word stays neutral (legacy clients,
 * bot concept clues, board words).
 */
export function referenceSignal(word: string): CaseSignal {
    const sig = caseSignal(word);
    if (sig === 'neutral' && /\p{Lu}/u.test(word) && CANONICAL_KEYS.has(word)) return 'proper';
    return sig;
}
