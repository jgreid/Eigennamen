import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// 1) Parse the authoritative board-word list.
const grc = readFileSync(join(ROOT, 'server/src/shared/gameRules.ts'), 'utf8');
const m = grc.match(/DEFAULT_WORDS\s*=\s*\[([\s\S]*?)\]\s*as const;/);
const BOARD = new Set((m[1].match(/'[^']+'/g) || []).map((w) => w.replace(/'/g, '').toUpperCase()));

// 2) Concept -> candidate board words. Candidates not on the board are dropped by
//    the filter below, so it is safe to be generous. Keys are clue words (uppercase).
//    An entry may be a plain word (edge weight 1 — the classic form) or a weighted
//    edge `{ word, weight?, kind?, collocation? }` carrying the Phase-2 per-edge
//    channels (see server/src/bots/semantics/associationIndex.ts EdgeMeta); both
//    forms load identically through buildAssociationIndex.
const CANDIDATES = {
    ANIMAL: ['BEAR','LION','HORSE','DOG','CAT','WHALE','SHARK','MOUSE','OCTOPUS','PANDA','KANGAROO','RABBIT','BUFFALO','SCORPION','SEAL','DUCK','MOLE','PLATYPUS','CALF','CHICK','FISH'],
    MAMMAL: ['BEAR','LION','HORSE','DOG','CAT','WHALE','MOUSE','PANDA','KANGAROO','RABBIT','BUFFALO','SEAL','MOLE','PLATYPUS','CALF'],
    BIRD: ['EAGLE','HAWK','ROBIN','DUCK','CRANE','PENGUIN','KIWI','PHOENIX','CHICK'],
    INSECT: ['BUG','FLY','SPIDER','TICK','WEB','SCORPION','WORM','SLUG'],
    PET: ['DOG','CAT','RABBIT','MOUSE','FISH'],
    FARM: ['HORSE','BUFFALO','CALF','CHICK','DUCK','FIELD','FENCE','GRASS','MOUSE','BARK'],
    WILD: ['LION','BEAR','BUFFALO','FOREST','EAGLE','HAWK'],
    WATER: ['BEACH','WAVE','STREAM','POOL','ICE','SHIP','SUB','PORT','SINK','DROP','WELL'],
    OCEAN: ['WHALE','SHARK','SEAL','OCTOPUS','WAVE','SHIP','SCUBA DIVER','BEACH'],
    SEA: ['WHALE','SHARK','SEAL','OCTOPUS','WAVE','SHIP','BEACH','PORT','SCUBA DIVER','SUB'],
    RIVER: ['STREAM','BRIDGE','BANK','FISH','DROP'],
    SWIM: ['WHALE','SHARK','SEAL','FISH','POOL','WAVE','SCUBA DIVER','DUCK'],
    BOAT: ['SHIP','SUB','PORT','DECK','ROW'],
    SPACE: ['MOON','STAR','ALIEN','JUPITER','SATURN','MERCURY','SATELLITE','TELESCOPE'],
    PLANET: ['JUPITER','SATURN','MERCURY','MOON','STAR'],
    SKY: ['STAR','MOON','PLANE','JET','WIND'],
    BODY: ['ARM','EYE','FACE','FOOT','HAND','HEAD','HEART','THUMB','TOOTH','MOUTH','SHOULDER','SPINE','NAIL','BACK'],
    MUSIC: ['BAND','NOTE','OPERA','PIANO','CONCERT','ORGAN','HORN','BUGLE','FLUTE','CONDUCTOR','STRING'],
    INSTRUMENT: ['PIANO','ORGAN','HORN','BUGLE','FLUTE','STRING','DRILL'],
    SOUND: ['NOTE','HORN','BELL','BOOM','ECHO','BAND','OPERA'],
    WINTER: ['ICE','SNOW','SNOWMAN','ANTARCTICA','ALPS','HIMALAYAS','COLD','ICE CREAM'],
    COLD: ['ICE','SNOW','SNOWMAN','ANTARCTICA','COLD','WIND'],
    SNOW: ['ICE','SNOW','SNOWMAN','ALPS','HIMALAYAS','COLD'],
    MOUNTAIN: ['ALPS','HIMALAYAS','CLIFF','MOUNT','VOLCANO','OLYMPUS'],
    ROYAL: ['KING','QUEEN','PRINCESS','CROWN','KNIGHT','RULER'],
    CASTLE: ['KING','QUEEN','KNIGHT','CROWN','TOWER','WALL'],
    WAR: ['SOLDIER','FIGHTER','MISSILE','BOMB','PISTOL','FORCE','STRIKE','SHOT'],
    WEAPON: ['PISTOL','MISSILE','BOMB','SHOT','KNIFE','SPIKE','WHIP','BOW','FORCE','NET'],
    ARMY: ['SOLDIER','FIGHTER','FORCE','WAR','STRIKE','MISSILE','BOMB'],
    SPY: ['AGENT','SPY','NINJA','SMUGGLER','CODE','COVER','EMBASSY','CONTRACT'],
    SECRET: ['SPY','AGENT','CODE','COVER','CLOAK','SHADOW','EMBASSY','CONTRACT'],
    MONEY: ['BANK','BILL','GOLD','MINT','POUND','CASINO','MILLIONAIRE','CARD','STOCK','CHANGE'],
    RICH: ['GOLD','BANK','MILLIONAIRE','DIAMOND','LIMOUSINE','CASINO','CROWN'],
    GAMBLE: ['CASINO','ROULETTE','DICE','CARD','DECK','CLUB','LUCK'],
    SPORT: ['BALL','RACKET','CRICKET','COURT','PITCH','FIELD','BAT','STADIUM','MATCH'],
    BALL: ['RACKET','COURT','FIELD','BAT','PITCH','NET','BOWL'],
    GAME: ['BALL','CARD','DICE','DECK','MATCH','PLAY','CLUB','BAT','NET','RACKET'],
    ANCIENT: ['PYRAMID','EGYPT','AZTEC','TEMPLE','ATLANTIS','DINOSAUR','MAMMOTH','IVORY'],
    HISTORY: ['EGYPT','AZTEC','PYRAMID','TEMPLE','MAMMOTH','DINOSAUR','REVOLUTION','SHAKESPEARE'],
    CITY: ['BERLIN','ROME','LONDON','MOSCOW','TOKYO','BEIJING','NEW YORK','WASHINGTON','CAPITAL'],
    COUNTRY: ['AFRICA','AMERICA','AUSTRALIA','CANADA','CHINA','ENGLAND','FRANCE','GERMANY','GREECE','INDIA','MEXICO','TURKEY','EUROPE','CZECH'],
    TRAVEL: ['PLANE','JET','SHIP','TRAIN','HOTEL','PORT','PASS','MAP'],
    FOOD: ['APPLE','CARROT','CHOCOLATE','HONEY','JAM','KETCHUP','LEMON','OLIVE','ORANGE','PIE','PUMPKIN','HAM','NUT','BERRY'],
    FRUIT: ['APPLE','LEMON','ORANGE','BERRY','KIWI','OLIVE'],
    SWEET: ['CHOCOLATE','HONEY','JAM','PIE','ICE CREAM','BERRY','ORANGE','LEMON','APPLE'],
    DRINK: ['WATER','BOTTLE','MUG','STRAW','BAR','ICE'],
    KITCHEN: ['PLATE','FORK','PAN','COOK','MUG','BOTTLE','KNIFE','STRAW'],
    COOK: ['PAN','COOK','PLATE','FORK','KNIFE','HAM','PIE','HONEY'],
    MYTH: ['DRAGON','UNICORN','GHOST','GIANT','DWARF','ANGEL','WITCH','LEPRECHAUN','CENTAUR','PHOENIX'],
    MAGIC: ['WITCH','SPELL','DRAGON','GHOST','UNICORN','PHOENIX','ANGEL'],
    MONSTER: ['DRAGON','GIANT','WITCH','GHOST','DWARF','CENTAUR','MAMMOTH','DINOSAUR'],
    HERO: ['SUPERHERO','ROBOT','KNIGHT','GIANT','NINJA','AGENT'],
    SCHOOL: ['TEACHER','PUPIL','SCHOOL','BOARD','NOTE','PAPER','DEGREE'],
    SCIENCE: ['LAB','MICROSCOPE','TELESCOPE','SCIENTIST','ENGINE','ROBOT','GAS','CELL'],
    TOOL: ['DRILL','HOOK','NAIL','NEEDLE','KNIFE','FORK','SCALE','WASHER','PIPE','BOLT'],
    BUILD: ['TOWER','BRIDGE','WALL','SKYSCRAPER','BLOCK','COMPOUND','DRILL','BOLT'],
    BUILDING: ['TOWER','SKYSCRAPER','CHURCH','HOTEL','HOSPITAL','SCHOOL','STADIUM','BANK','EMBASSY','TEMPLE'],
    LIGHT: ['TORCH','LASER','RAY','FIRE','LIGHT','STAR','MATCH'],
    METAL: ['IRON','GOLD','COPPER','LEAD','MARBLE'],
    JEWEL: ['DIAMOND','GOLD','RING','CROWN','IVORY'],
    TRANSPORT: ['CAR','VAN','TRAIN','PLANE','JET','SHIP','HELICOPTER','LIMOUSINE','AMBULANCE','ENGINE','TUBE'],
    CAR: ['ENGINE','VAN','LIMOUSINE','AMBULANCE','TRUNK','TRACK','JACK'],
    AIR: ['PLANE','JET','HELICOPTER','PARACHUTE','WIND','EAGLE','HAWK'],
    TIME: ['DAY','NIGHT','TIME','WATCH','SPRING','MARCH','DATE'],
    CRIME: ['THIEF','SMUGGLER','PIRATE','POLICE','AGENT','SPY','LAWYER','COURT'],
    LAW: ['LAWYER','COURT','POLICE','JUDGE','CONTRACT'],
    NATURE: ['FOREST','GRASS','ROSE','MAPLE','ROOT','PALM','GREEN','GROUND','LOG','STICK'],
    TREE: ['MAPLE','PALM','ROOT','LOG','FOREST','TRUNK','BARK','STICK'],
    PLANT: ['ROSE','GRASS','MAPLE','PALM','ROOT','FOREST','OLIVE'],
    HOSPITAL: ['DOCTOR','NURSE','AMBULANCE','HOSPITAL','DISEASE','VET','LAB','NEEDLE'],
    MEDICINE: ['DOCTOR','NURSE','DISEASE','HOSPITAL','NEEDLE','VET','LAB'],
    FIRE: ['TORCH','MATCH','VOLCANO','BOMB','LIGHT','RAY'],
    GHOSTLY: ['GHOST','SHADOW','SOUL','DEATH','WITCH','NIGHT'],
    DARK: ['SHADOW','NIGHT','GHOST','SOUL','DEATH','CLOAK'],
    THEATRE: ['OPERA','PLAY','FILM','HOLLYWOOD','STAR','CAST','MODEL'],
    MOVIE: ['FILM','HOLLYWOOD','STAR','CAST','SCREEN','PLOT','COMIC'],
    ART: ['OPERA','PLAY','FILM','MODEL','FIGURE','COMIC','NOVEL'],
    BOOK: ['NOVEL','NOTE','PRESS','COMIC','PLOT','FILE','SHAKESPEARE','PAPER'],
    PAPER: ['NOTE','PAPER','CARD','MAIL','POST','NOVEL','PRESS','FILE'],
    KEY: ['KEY','LOCK','CODE','PASS','CHEST','SAFE'],
    LOCK: ['KEY','LOCK','CHEST','SAFE','BOLT','PASS'],
    POWER: ['BATTERY','CHARGE','CELL','ENGINE','FORCE','BOLT'],
    CLOTHES: ['BOOT','BELT','CAP','DRESS','GLOVE','SHOE','SOCK','SUIT','CLOAK','HOOD','TIE','SILK','COTTON'],
    SHAPE: ['CIRCLE','SQUARE','TRIANGLE','POINT','LINE','ROUND','DIAMOND','CROSS'],
    ROUND: ['CIRCLE','BALL','RING','PLATE','MOON'],
    WIND: ['WIND','AIR','PLANE','JET','FAN','MILL'],
    DIG: ['HOLE','MOLE','MINE','GROUND','PIT','DRILL'],
    HOLE: ['HOLE','PIT','MINE','TUNNEL','WELL','MOLE'],
    DOG: ['BARK','TAIL'],
    POKER: ['CARD','DECK','CLUB','JACK','QUEEN','KING','CASINO','DICE'],
    GHOST: ['GHOST','SHADOW','SOUL','SPIRIT','WITCH'],
};

// 3) Filter to real board words, drop near-empty concepts, dedupe. Plain-string
//    and weighted-edge entries both pass through; only the word is normalized.
//    Weighted entries are validated (weight/collocation in (0, 1], kind from
//    the EdgeKind set) so a typo in CANDIDATES fails loudly here instead of
//    emitting a table the runtime validators would choke on. Words are also
//    shape-checked before they reach the generated source (defense in depth —
//    a quote or backslash in a word would otherwise break the emitted TS).
const EDGE_KINDS = ['content', 'member', 'part', 'compound', 'function', 'attribute'];
const inUnit = (v) => typeof v === 'number' && v > 0 && v <= 1;
const SAFE_WORD = /^[A-Z][A-Z ]*$/;

function validateEntry(clue, entry) {
    const word = (typeof entry === 'string' ? entry : entry.word).toUpperCase();
    if (!SAFE_WORD.test(word)) throw new Error(`${clue}: unsafe word ${JSON.stringify(word)}`);
    if (typeof entry === 'string') return word;
    if (entry.weight !== undefined && !inUnit(entry.weight)) throw new Error(`${clue}/${word}: bad weight`);
    if (entry.collocation !== undefined && !inUnit(entry.collocation))
        throw new Error(`${clue}/${word}: bad collocation`);
    if (entry.kind !== undefined && !EDGE_KINDS.includes(entry.kind)) throw new Error(`${clue}/${word}: bad kind`);
    return { ...entry, word };
}

const out = {};
const dropped = {};
for (const [clue, words] of Object.entries(CANDIDATES)) {
    if (!SAFE_WORD.test(clue.toUpperCase())) throw new Error(`unsafe clue key ${JSON.stringify(clue)}`);
    const kept = [];
    const drop = [];
    const seen = new Set();
    for (const entry of words) {
        const validated = validateEntry(clue, entry);
        const W = typeof validated === 'string' ? validated : validated.word;
        if (seen.has(W)) continue;
        seen.add(W);
        if (BOARD.has(W)) kept.push(validated);
        else drop.push(W);
    }
    if (kept.length >= 2) out[clue] = kept;
    if (drop.length) dropped[clue] = drop;
}

// 4) Emit a formatted TS source for associations.ts.
const header = `/**
 * Baked word-association table (the "LLM-offline -> baked table" backend, section 20).
 *
 * Each entry maps a CLUE word to the board words (from the standard set) it is
 * semantically related to — a plain word is an edge of weight 1, a weighted
 * entry carries the Phase-2 per-edge channels (see associationIndex.ts).
 * Every target is verified to be a real entry in DEFAULT_WORDS
 * (server/src/shared/gameRules.ts); clues whose targets are not on the board
 * are useless, so this table is generated through that filter. The
 * tableBackend falls back to lexical similarity for any pair not covered here, so
 * custom / out-of-vocabulary word lists still degrade gracefully.
 *
 * Keyed by clue word, uppercased; keys are the spymaster's candidate clue
 * vocabulary. DO NOT edit by hand: add concept -> board-word groups in
 * scripts/generate-associations.mjs and re-run \`npm run bots:associations\`.
 */
import type { AssociationTarget } from './associationIndex';

export const ASSOCIATIONS: Record<string, AssociationTarget[]> = {
`;
const fmtEntry = (entry) => {
    if (typeof entry === 'string') return `'${entry}'`;
    const fields = [`word: '${entry.word}'`];
    if (entry.weight !== undefined) fields.push(`weight: ${entry.weight}`);
    if (entry.kind !== undefined) fields.push(`kind: '${entry.kind}'`);
    if (entry.collocation !== undefined) fields.push(`collocation: ${entry.collocation}`);
    return `{ ${fields.join(', ')} }`;
};
const body = Object.entries(out)
    .map(([clue, words]) => {
        const items = words.map(fmtEntry).join(', ');
        const line = `    ${clue}: [${items}],`;
        if (line.length <= 116) return line;
        // wrap long arrays
        const wrapped = words.map((w) => `        ${fmtEntry(w)},`).join('\n');
        return `    ${clue}: [\n${wrapped}\n    ],`;
    })
    .join('\n');
const src = `${header}${body}\n};\n`;

writeFileSync(join(ROOT, 'server/src/bots/semantics/associations.ts'), src);

// Format with the repo's prettier so the output matches `npm run format:check`
// (this script's own line-wrapping differs slightly from prettier's).
try {
    execSync('npx prettier --write src/bots/semantics/associations.ts', {
        cwd: join(ROOT, 'server'),
        stdio: 'ignore',
    });
} catch {
    console.warn('(prettier not run — run `npm run format` in server/ to format the output)');
}

const clueCount = Object.keys(out).length;
const pairCount = Object.values(out).reduce((a, w) => a + w.length, 0);
console.log(`Wrote associations.ts: ${clueCount} clues, ${pairCount} clue->word pairs.`);
console.log('Dropped (not on board):', JSON.stringify(dropped));
