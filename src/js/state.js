/**
 * Game State Management
 *
 * Centralized state management for the Codenames game.
 * Uses a simple observable pattern for state changes.
 *
 * @module state
 */

import {
  BOARD_SIZE,
  FIRST_TEAM_CARDS,
  SECOND_TEAM_CARDS,
  NEUTRAL_CARDS,
  ASSASSIN_CARDS,
  TEAM_RED,
  TEAM_BLUE,
  WORD_LIST_MODES,
} from './constants.js';

import {
  hashString,
  shuffleWithSeed,
  seededRandom,
} from './utils.js';

/**
 * Default word list for the game (400 classic Codenames words)
 */
export const DEFAULT_WORDS = [
  "AFRICA", "AGENT", "AIR", "ALIEN", "ALPS", "AMAZON", "AMBULANCE", "AMERICA",
  "ANGEL", "ANTARCTICA", "APPLE", "ARM", "ATLANTIS", "AUSTRALIA", "AZTEC",
  "BACK", "BALL", "BAND", "BANK", "BAR", "BARK", "BAT", "BATTERY", "BEACH",
  "BEAR", "BEAT", "BED", "BEIJING", "BELL", "BELT", "BERLIN", "BERMUDA",
  "BERRY", "BILL", "BLOCK", "BOARD", "BOLT", "BOMB", "BOND", "BOOM", "BOOT",
  "BOTTLE", "BOW", "BOX", "BRIDGE", "BRUSH", "BUCK", "BUFFALO", "BUG",
  "BUGLE", "BUTTON", "CALF", "CANADA", "CAP", "CAPITAL", "CAR", "CARD",
  "CARROT", "CASINO", "CAST", "CAT", "CELL", "CENTAUR", "CENTER", "CHAIR",
  "CHANGE", "CHARGE", "CHECK", "CHEST", "CHICK", "CHINA", "CHOCOLATE",
  "CHURCH", "CIRCLE", "CLIFF", "CLOAK", "CLUB", "CODE", "COLD", "COMIC",
  "COMPOUND", "CONCERT", "CONDUCTOR", "CONTRACT", "COOK", "COPPER", "COTTON",
  "COURT", "COVER", "CRANE", "CRASH", "CRICKET", "CROSS", "CROWN", "CYCLE",
  "CZECH", "DANCE", "DATE", "DAY", "DEATH", "DECK", "DEGREE", "DIAMOND",
  "DICE", "DINOSAUR", "DISEASE", "DOCTOR", "DOG", "DRAFT", "DRAGON", "DRESS",
  "DRILL", "DROP", "DUCK", "DWARF", "EAGLE", "EGYPT", "EMBASSY", "ENGINE",
  "ENGLAND", "EUROPE", "EYE", "FACE", "FAIR", "FALL", "FAN", "FENCE", "FIELD",
  "FIGHTER", "FIGURE", "FILE", "FILM", "FIRE", "FISH", "FLUTE", "FLY",
  "FOOT", "FORCE", "FOREST", "FORK", "FRANCE", "GAME", "GAS", "GENIUS",
  "GERMANY", "GHOST", "GIANT", "GLASS", "GLOVE", "GOLD", "GRACE", "GRASS",
  "GREECE", "GREEN", "GROUND", "HAM", "HAND", "HAWK", "HEAD", "HEART",
  "HELICOPTER", "HIMALAYAS", "HOLE", "HOLLYWOOD", "HONEY", "HOOD", "HOOK",
  "HORN", "HORSE", "HOSPITAL", "HOTEL", "ICE", "ICE CREAM", "INDIA", "IRON",
  "IVORY", "JACK", "JAM", "JET", "JUPITER", "KANGAROO", "KETCHUP", "KEY",
  "KID", "KING", "KIWI", "KNIFE", "KNIGHT", "LAB", "LAP", "LASER", "LAWYER",
  "LEAD", "LEMON", "LEPRECHAUN", "LIFE", "LIGHT", "LIMOUSINE", "LINE", "LINK",
  "LION", "LITTER", "LOCH NESS", "LOCK", "LOG", "LONDON", "LUCK", "MAIL",
  "MAMMOTH", "MAPLE", "MARBLE", "MARCH", "MASS", "MATCH", "MERCURY", "MEXICO",
  "MICROSCOPE", "MILLIONAIRE", "MINE", "MINT", "MISSILE", "MODEL", "MOLE",
  "MOON", "MOSCOW", "MOUNT", "MOUSE", "MOUTH", "MUG", "NAIL", "NEEDLE",
  "NET", "NEW YORK", "NIGHT", "NINJA", "NOTE", "NOVEL", "NURSE", "NUT",
  "OCTOPUS", "OIL", "OLIVE", "OLYMPUS", "OPERA", "ORANGE", "ORGAN", "PALM",
  "PAN", "PANDA", "PAPER", "PARACHUTE", "PARK", "PART", "PASS", "PASTE",
  "PENGUIN", "PHOENIX", "PIANO", "PIE", "PILOT", "PIN", "PIPE", "PIRATE",
  "PISTOL", "PIT", "PITCH", "PLANE", "PLASTIC", "PLATE", "PLATYPUS",
  "PLAY", "PLOT", "POINT", "POISON", "POLE", "POLICE", "POOL", "PORT",
  "POST", "POUND", "PRESS", "PRINCESS", "PUMPKIN", "PUPIL", "PYRAMID",
  "QUEEN", "RABBIT", "RACKET", "RAY", "REVOLUTION", "RING", "ROBIN", "ROBOT",
  "ROCK", "ROME", "ROOT", "ROSE", "ROULETTE", "ROUND", "ROW", "RULER",
  "SATELLITE", "SATURN", "SCALE", "SCHOOL", "SCIENTIST", "SCORPION", "SCREEN",
  "SCUBA DIVER", "SEAL", "SERVER", "SHADOW", "SHAKESPEARE", "SHARK", "SHIP",
  "SHOE", "SHOP", "SHOT", "SHOULDER", "SILK", "SINK", "SKYSCRAPER", "SLIP",
  "SLUG", "SMUGGLER", "SNOW", "SNOWMAN", "SOCK", "SOLDIER", "SOUL", "SOUND",
  "SPACE", "SPELL", "SPIDER", "SPIKE", "SPINE", "SPOT", "SPRING", "SPY",
  "SQUARE", "STADIUM", "STAFF", "STAR", "STATE", "STICK", "STOCK", "STRAW",
  "STREAM", "STRIKE", "STRING", "SUB", "SUIT", "SUPERHERO", "SWING", "SWITCH",
  "TABLE", "TABLET", "TAG", "TAIL", "TAP", "TEACHER", "TELESCOPE", "TEMPLE",
  "THIEF", "THUMB", "TICK", "TIE", "TIME", "TOKYO", "TOOTH", "TORCH", "TOWER",
  "TRACK", "TRAIN", "TRIANGLE", "TRIP", "TRUNK", "TUBE", "TURKEY", "UNDERTAKER",
  "UNICORN", "VACUUM", "VAN", "VET", "VOLCANO", "WALL", "WAR", "WASHER",
  "WASHINGTON", "WATCH", "WATER", "WAVE", "WEB", "WELL", "WHALE", "WHIP",
  "WIND", "WITCH", "WORM", "YARD"
];

/**
 * Create initial game state
 * @returns {Object} Fresh game state object
 */
function createInitialGameState() {
  return {
    words: [],
    types: [],           // 'red', 'blue', 'neutral', 'assassin'
    revealed: [],
    currentTurn: TEAM_RED,
    redScore: 0,
    blueScore: 0,
    redTotal: FIRST_TEAM_CARDS,
    blueTotal: SECOND_TEAM_CARDS,
    gameOver: false,
    winner: null,
    seed: null,
    customWords: false,  // Whether this game uses custom words encoded in URL
  };
}

/**
 * Create initial player state
 * @returns {Object} Fresh player state object
 */
function createInitialPlayerState() {
  return {
    isHost: false,
    spymasterTeam: null,  // null, 'red', or 'blue'
    clickerTeam: null,    // null, 'red', or 'blue'
    playerTeam: null,     // null, 'red', or 'blue' - team affiliation
  };
}

/**
 * Create initial word list state
 * @returns {Object} Fresh word list state object
 */
function createInitialWordListState() {
  return {
    activeWords: [...DEFAULT_WORDS],
    wordSource: 'default',
    wordListMode: WORD_LIST_MODES.COMBINED,
    customWordsList: [],
  };
}

/**
 * Create initial team state
 * @returns {Object} Fresh team state object
 */
function createInitialTeamState() {
  return {
    red: 'Red',
    blue: 'Blue',
  };
}

/**
 * Create initial multiplayer state
 * @returns {Object} Fresh multiplayer state object
 */
function createInitialMultiplayerState() {
  return {
    mode: 'standalone',      // 'standalone' or 'multiplayer'
    connected: false,
    roomCode: null,
    roomPassword: null,
    players: [],             // Array of player objects
    isHost: false,
    currentClue: null,       // { word, number, team, spymaster }
    guessesAllowed: 0,
    guessesUsed: 0,
    timer: null,             // { remaining, total, running }
    settings: {
      turnTimeLimit: 0,      // 0 = no limit
      strictSpymaster: false,
      allowSpectators: true,
    },
  };
}

// State containers
let gameState = createInitialGameState();
let playerState = createInitialPlayerState();
let wordListState = createInitialWordListState();
let teamNames = createInitialTeamState();
let multiplayerState = createInitialMultiplayerState();

// State change listeners
const listeners = new Set();

/**
 * Subscribe to state changes
 * @param {Function} callback - Function to call on state change
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Notify all listeners of state change
 * @param {string} type - Type of state change
 * @param {Object} [data] - Additional data about the change
 */
function notifyListeners(type, data = {}) {
  listeners.forEach(callback => {
    try {
      callback({ type, ...data });
    } catch (e) {
      console.error('State listener error:', e);
    }
  });
}

// ============ Game State Getters ============

/**
 * Get current game state (read-only copy)
 * @returns {Object} Current game state
 */
export function getGameState() {
  return { ...gameState };
}

/**
 * Get current player state (read-only copy)
 * @returns {Object} Current player state
 */
export function getPlayerState() {
  return { ...playerState };
}

/**
 * Get current word list state (read-only copy)
 * @returns {Object} Current word list state
 */
export function getWordListState() {
  return { ...wordListState };
}

/**
 * Get current team names (read-only copy)
 * @returns {Object} Current team names
 */
export function getTeamNames() {
  return { ...teamNames };
}

/**
 * Get current multiplayer state (read-only copy)
 * @returns {Object} Current multiplayer state
 */
export function getMultiplayerState() {
  return {
    ...multiplayerState,
    players: [...multiplayerState.players],
    settings: { ...multiplayerState.settings },
    timer: multiplayerState.timer ? { ...multiplayerState.timer } : null,
    currentClue: multiplayerState.currentClue ? { ...multiplayerState.currentClue } : null,
  };
}

/**
 * Check if in multiplayer mode
 * @returns {boolean}
 */
export function isMultiplayerMode() {
  return multiplayerState.mode === 'multiplayer';
}

// ============ Game State Setters ============

/**
 * Set up the game board (card types, scores, etc.)
 * @param {number} numericSeed - Numeric seed for randomization
 */
export function setupGameBoard(numericSeed) {
  // Randomly decide who goes first (gets more cards)
  const firstTeam = seededRandom(numericSeed + 1000) > 0.5 ? TEAM_RED : TEAM_BLUE;
  gameState.currentTurn = firstTeam;

  // Create card types: first team gets more cards
  let types = [];
  if (firstTeam === TEAM_RED) {
    types = Array(FIRST_TEAM_CARDS).fill(TEAM_RED)
      .concat(Array(SECOND_TEAM_CARDS).fill(TEAM_BLUE));
    gameState.redTotal = FIRST_TEAM_CARDS;
    gameState.blueTotal = SECOND_TEAM_CARDS;
  } else {
    types = Array(SECOND_TEAM_CARDS).fill(TEAM_RED)
      .concat(Array(FIRST_TEAM_CARDS).fill(TEAM_BLUE));
    gameState.redTotal = SECOND_TEAM_CARDS;
    gameState.blueTotal = FIRST_TEAM_CARDS;
  }
  types = types.concat(
    Array(NEUTRAL_CARDS).fill('neutral'),
    Array(ASSASSIN_CARDS).fill('assassin')
  );

  // Shuffle the types and reset game state
  gameState.types = shuffleWithSeed(types, numericSeed + 500);
  gameState.revealed = Array(BOARD_SIZE).fill(false);
  gameState.redScore = 0;
  gameState.blueScore = 0;
  gameState.gameOver = false;
  gameState.winner = null;

  notifyListeners('boardSetup', { firstTeam });
}

/**
 * Initialize game with specific board words (no shuffling needed)
 * @param {string} seed - Game seed
 * @param {string[]} boardWords - Exact 25 words for the board
 * @returns {boolean} Success status
 */
export function initGameWithWords(seed, boardWords) {
  if (boardWords.length !== BOARD_SIZE) {
    return false;
  }

  gameState.seed = seed;
  gameState.words = boardWords;
  gameState.customWords = true;

  setupGameBoard(hashString(seed));
  notifyListeners('gameInit', { seed, customWords: true });
  return true;
}

/**
 * Initialize game with a word list (selects random words for the board)
 * @param {string} seed - Game seed
 * @param {string[]} [wordList] - Word list to use (defaults to activeWords)
 * @returns {boolean} Success status
 */
export function initGame(seed, wordList) {
  const words = wordList || wordListState.activeWords;

  if (words.length < BOARD_SIZE) {
    return false;
  }

  gameState.seed = seed;
  gameState.customWords = (words !== DEFAULT_WORDS && wordListState.wordSource !== 'default');
  const numericSeed = hashString(seed);

  // Select random words using the provided word list
  const shuffledWords = shuffleWithSeed(words, numericSeed);
  gameState.words = shuffledWords.slice(0, BOARD_SIZE);

  setupGameBoard(numericSeed);
  notifyListeners('gameInit', { seed, customWords: gameState.customWords });
  return true;
}

/**
 * Reveal a card at the given index
 * @param {number} index - Card index (0-24)
 * @returns {Object|null} Result with type and game over info, or null if invalid
 */
export function revealCard(index) {
  if (index < 0 || index >= BOARD_SIZE) return null;
  if (gameState.revealed[index]) return null;
  if (gameState.gameOver) return null;

  gameState.revealed[index] = true;
  const type = gameState.types[index];

  // Update scores
  if (type === TEAM_RED) {
    gameState.redScore++;
  } else if (type === TEAM_BLUE) {
    gameState.blueScore++;
  }

  // Check for game over conditions
  let gameOver = false;
  let winner = null;
  let reason = null;

  if (type === 'assassin') {
    gameOver = true;
    winner = gameState.currentTurn === TEAM_RED ? TEAM_BLUE : TEAM_RED;
    reason = 'assassin';
  } else if (gameState.redScore >= gameState.redTotal) {
    gameOver = true;
    winner = TEAM_RED;
    reason = 'allFound';
  } else if (gameState.blueScore >= gameState.blueTotal) {
    gameOver = true;
    winner = TEAM_BLUE;
    reason = 'allFound';
  }

  if (gameOver) {
    gameState.gameOver = true;
    gameState.winner = winner;
  }

  // End turn if wrong team or neutral
  let turnEnded = false;
  if (!gameOver && type !== gameState.currentTurn) {
    gameState.currentTurn = gameState.currentTurn === TEAM_RED ? TEAM_BLUE : TEAM_RED;
    turnEnded = true;
  }

  const result = {
    index,
    type,
    gameOver,
    winner,
    reason,
    turnEnded,
    newTurn: gameState.currentTurn,
  };

  notifyListeners('cardRevealed', result);
  return result;
}

/**
 * End the current turn
 */
export function endTurn() {
  if (gameState.gameOver) return;

  const previousTurn = gameState.currentTurn;
  gameState.currentTurn = gameState.currentTurn === TEAM_RED ? TEAM_BLUE : TEAM_RED;

  notifyListeners('turnEnded', {
    previousTurn,
    newTurn: gameState.currentTurn,
  });
}

/**
 * Set revealed state for a card (used when loading from URL)
 * @param {number} index - Card index
 * @param {boolean} revealed - Whether card is revealed
 */
export function setCardRevealed(index, revealed) {
  if (index < 0 || index >= BOARD_SIZE) return;

  const wasRevealed = gameState.revealed[index];
  gameState.revealed[index] = revealed;

  // Update scores when setting revealed state
  if (revealed && !wasRevealed) {
    const type = gameState.types[index];
    if (type === TEAM_RED) gameState.redScore++;
    if (type === TEAM_BLUE) gameState.blueScore++;
  }
}

/**
 * Set current turn
 * @param {string} team - 'red' or 'blue'
 */
export function setCurrentTurn(team) {
  if (team === TEAM_RED || team === TEAM_BLUE) {
    gameState.currentTurn = team;
  }
}

/**
 * Check and set game over state
 * @returns {Object|null} Game over info or null if game continues
 */
export function checkGameOver() {
  if (gameState.redScore >= gameState.redTotal) {
    gameState.gameOver = true;
    gameState.winner = TEAM_RED;
    return { winner: TEAM_RED, reason: 'allFound' };
  }
  if (gameState.blueScore >= gameState.blueTotal) {
    gameState.gameOver = true;
    gameState.winner = TEAM_BLUE;
    return { winner: TEAM_BLUE, reason: 'allFound' };
  }
  // Check for assassin (already revealed)
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (gameState.revealed[i] && gameState.types[i] === 'assassin') {
      gameState.gameOver = true;
      // Winner is opposite of whoever revealed assassin (can't determine from state alone)
      return { winner: gameState.winner, reason: 'assassin' };
    }
  }
  return null;
}

/**
 * Reset game state to initial values
 */
export function resetGameState() {
  gameState = createInitialGameState();
  notifyListeners('gameReset');
}

// ============ Player State Setters ============

/**
 * Set player as host
 * @param {boolean} isHost - Host status
 */
export function setIsHost(isHost) {
  playerState.isHost = isHost;
  notifyListeners('playerStateChange', { isHost });
}

/**
 * Set spymaster team
 * @param {string|null} team - 'red', 'blue', or null
 */
export function setSpymasterTeam(team) {
  playerState.spymasterTeam = team;
  // Clear clicker if becoming spymaster
  if (team) {
    playerState.clickerTeam = null;
    playerState.playerTeam = team;
  }
  notifyListeners('playerStateChange', { spymasterTeam: team });
}

/**
 * Set clicker team
 * @param {string|null} team - 'red', 'blue', or null
 */
export function setClickerTeam(team) {
  playerState.clickerTeam = team;
  // Clear spymaster if becoming clicker
  if (team) {
    playerState.spymasterTeam = null;
    playerState.playerTeam = team;
  }
  notifyListeners('playerStateChange', { clickerTeam: team });
}

/**
 * Set player team affiliation
 * @param {string|null} team - 'red', 'blue', or null
 */
export function setPlayerTeam(team) {
  playerState.playerTeam = team;
  notifyListeners('playerStateChange', { playerTeam: team });
}

/**
 * Reset player state (clears roles but keeps host status)
 */
export function resetPlayerRoles() {
  playerState.spymasterTeam = null;
  playerState.clickerTeam = null;
  // Keep playerTeam - team affiliation persists across games
  notifyListeners('playerStateChange', { rolesReset: true });
}

// ============ Word List State Setters ============

/**
 * Set active word list
 * @param {string[]} words - Word list to use
 * @param {string} source - Source identifier
 */
export function setActiveWords(words, source = 'custom') {
  wordListState.activeWords = [...words];
  wordListState.wordSource = source;
  notifyListeners('wordListChange', { source });
}

/**
 * Set word list mode
 * @param {string} mode - 'default', 'combined', or 'custom'
 */
export function setWordListMode(mode) {
  if (Object.values(WORD_LIST_MODES).includes(mode)) {
    wordListState.wordListMode = mode;
    notifyListeners('wordListChange', { mode });
  }
}

/**
 * Set custom words list
 * @param {string[]} words - Custom words
 */
export function setCustomWordsList(words) {
  wordListState.customWordsList = [...words];
  notifyListeners('wordListChange', { customWords: words.length });
}

/**
 * Update active words based on current mode and custom words
 */
export function updateActiveWordsFromMode() {
  const mode = wordListState.wordListMode;
  const customWords = wordListState.customWordsList;

  switch (mode) {
    case WORD_LIST_MODES.DEFAULT:
      wordListState.activeWords = [...DEFAULT_WORDS];
      wordListState.wordSource = 'default';
      break;
    case WORD_LIST_MODES.CUSTOM:
      wordListState.activeWords = [...customWords];
      wordListState.wordSource = 'custom';
      break;
    case WORD_LIST_MODES.COMBINED:
    default:
      // Combine and deduplicate
      const combined = new Set([...DEFAULT_WORDS, ...customWords]);
      wordListState.activeWords = [...combined];
      wordListState.wordSource = customWords.length > 0 ? 'combined' : 'default';
      break;
  }

  notifyListeners('wordListChange', {
    mode,
    wordCount: wordListState.activeWords.length,
  });
}

// ============ Team Name Setters ============

/**
 * Set team name
 * @param {string} team - 'red' or 'blue'
 * @param {string} name - New team name
 */
export function setTeamName(team, name) {
  if (team === TEAM_RED || team === TEAM_BLUE) {
    teamNames[team] = name;
    notifyListeners('teamNameChange', { team, name });
  }
}

/**
 * Set both team names at once
 * @param {Object} names - { red: string, blue: string }
 */
export function setTeamNames(names) {
  if (names.red) teamNames.red = names.red;
  if (names.blue) teamNames.blue = names.blue;
  notifyListeners('teamNameChange', { ...teamNames });
}

/**
 * Reset team names to defaults
 */
export function resetTeamNames() {
  teamNames = createInitialTeamState();
  notifyListeners('teamNameChange', { ...teamNames });
}

// ============ Multiplayer State Setters ============

/**
 * Set multiplayer mode
 * @param {string} mode - 'standalone' or 'multiplayer'
 */
export function setMultiplayerMode(mode) {
  multiplayerState.mode = mode;
  notifyListeners('modeChange', { mode });
}

/**
 * Set connection status
 * @param {boolean} connected - Connection status
 */
export function setConnected(connected) {
  multiplayerState.connected = connected;
  notifyListeners('connectionChange', { connected });
}

/**
 * Set room info
 * @param {string} code - Room code
 * @param {string} [password] - Room password (optional)
 */
export function setRoomInfo(code, password = null) {
  multiplayerState.roomCode = code;
  multiplayerState.roomPassword = password;
  notifyListeners('roomChange', { code, password });
}

/**
 * Clear room info (when leaving)
 */
export function clearRoomInfo() {
  multiplayerState.roomCode = null;
  multiplayerState.roomPassword = null;
  multiplayerState.players = [];
  multiplayerState.currentClue = null;
  multiplayerState.guessesAllowed = 0;
  multiplayerState.guessesUsed = 0;
  multiplayerState.timer = null;
  notifyListeners('roomCleared');
}

/**
 * Set players list
 * @param {Array} players - Array of player objects
 */
export function setPlayers(players) {
  multiplayerState.players = [...players];
  notifyListeners('playersChange', { players: multiplayerState.players });
}

/**
 * Update a single player
 * @param {string} sessionId - Player's session ID
 * @param {Object} changes - Changes to apply
 */
export function updatePlayer(sessionId, changes) {
  const index = multiplayerState.players.findIndex(p => p.sessionId === sessionId);
  if (index !== -1) {
    multiplayerState.players[index] = { ...multiplayerState.players[index], ...changes };
    notifyListeners('playerUpdated', { sessionId, changes, player: multiplayerState.players[index] });
  }
}

/**
 * Add a player
 * @param {Object} player - Player object
 */
export function addPlayer(player) {
  const exists = multiplayerState.players.some(p => p.sessionId === player.sessionId);
  if (!exists) {
    multiplayerState.players.push(player);
    notifyListeners('playerJoined', { player });
  }
}

/**
 * Remove a player
 * @param {string} sessionId - Player's session ID
 */
export function removePlayer(sessionId) {
  const index = multiplayerState.players.findIndex(p => p.sessionId === sessionId);
  if (index !== -1) {
    const player = multiplayerState.players[index];
    multiplayerState.players.splice(index, 1);
    notifyListeners('playerLeft', { sessionId, player });
  }
}

/**
 * Set multiplayer host status
 * @param {boolean} isHost - Host status
 */
export function setMultiplayerHost(isHost) {
  multiplayerState.isHost = isHost;
  playerState.isHost = isHost;
  notifyListeners('hostChange', { isHost });
}

/**
 * Set current clue
 * @param {Object|null} clue - Clue object { word, number, team, spymaster }
 */
export function setCurrentClue(clue) {
  multiplayerState.currentClue = clue ? { ...clue } : null;
  if (clue) {
    multiplayerState.guessesAllowed = clue.number === 0 ? Infinity : clue.number + 1;
    multiplayerState.guessesUsed = 0;
  } else {
    multiplayerState.guessesAllowed = 0;
    multiplayerState.guessesUsed = 0;
  }
  notifyListeners('clueChange', { clue: multiplayerState.currentClue });
}

/**
 * Increment guesses used
 */
export function incrementGuessesUsed() {
  multiplayerState.guessesUsed++;
  notifyListeners('guessesChange', {
    used: multiplayerState.guessesUsed,
    allowed: multiplayerState.guessesAllowed,
  });
}

/**
 * Set timer state
 * @param {Object|null} timer - Timer object { remaining, total, running }
 */
export function setTimer(timer) {
  multiplayerState.timer = timer ? { ...timer } : null;
  notifyListeners('timerChange', { timer: multiplayerState.timer });
}

/**
 * Update room settings
 * @param {Object} settings - Settings to merge
 */
export function updateRoomSettings(settings) {
  multiplayerState.settings = { ...multiplayerState.settings, ...settings };
  notifyListeners('settingsChange', { settings: multiplayerState.settings });
}

/**
 * Reset multiplayer state
 */
export function resetMultiplayerState() {
  multiplayerState = createInitialMultiplayerState();
  notifyListeners('multiplayerReset');
}

// ============ Game History ============

// History of completed games (for replay feature)
let gameHistory = [];
const MAX_HISTORY_SIZE = 10;

/**
 * Save current game to history
 */
export function saveGameToHistory() {
  if (!gameState.gameOver) return;

  const historyEntry = {
    timestamp: Date.now(),
    seed: gameState.seed,
    words: [...gameState.words],
    types: [...gameState.types],
    revealed: [...gameState.revealed],
    winner: gameState.winner,
    redScore: gameState.redScore,
    blueScore: gameState.blueScore,
    teamNames: { ...teamNames },
  };

  gameHistory.unshift(historyEntry);

  // Keep only recent games
  if (gameHistory.length > MAX_HISTORY_SIZE) {
    gameHistory = gameHistory.slice(0, MAX_HISTORY_SIZE);
  }

  // Persist to localStorage
  try {
    localStorage.setItem('codenames_history', JSON.stringify(gameHistory));
  } catch (e) {
    console.warn('Could not save game history:', e);
  }

  notifyListeners('historySaved', { entry: historyEntry });
}

/**
 * Load game history from localStorage
 */
export function loadGameHistory() {
  try {
    const saved = localStorage.getItem('codenames_history');
    if (saved) {
      gameHistory = JSON.parse(saved);
    }
  } catch (e) {
    console.warn('Could not load game history:', e);
    gameHistory = [];
  }
  return gameHistory;
}

/**
 * Get game history
 * @returns {Array} Array of past games
 */
export function getGameHistory() {
  return [...gameHistory];
}

/**
 * Clear game history
 */
export function clearGameHistory() {
  gameHistory = [];
  try {
    localStorage.removeItem('codenames_history');
  } catch (e) {
    console.warn('Could not clear game history:', e);
  }
  notifyListeners('historyCleared');
}

// Default export
export default {
  // Constants
  DEFAULT_WORDS,

  // Subscriptions
  subscribe,

  // Getters
  getGameState,
  getPlayerState,
  getWordListState,
  getTeamNames,
  getGameHistory,
  getMultiplayerState,
  isMultiplayerMode,

  // Game state
  setupGameBoard,
  initGame,
  initGameWithWords,
  revealCard,
  endTurn,
  setCardRevealed,
  setCurrentTurn,
  checkGameOver,
  resetGameState,

  // Player state
  setIsHost,
  setSpymasterTeam,
  setClickerTeam,
  setPlayerTeam,
  resetPlayerRoles,

  // Word list
  setActiveWords,
  setWordListMode,
  setCustomWordsList,
  updateActiveWordsFromMode,

  // Team names
  setTeamName,
  setTeamNames,
  resetTeamNames,

  // Multiplayer
  setMultiplayerMode,
  setConnected,
  setRoomInfo,
  clearRoomInfo,
  setPlayers,
  updatePlayer,
  addPlayer,
  removePlayer,
  setMultiplayerHost,
  setCurrentClue,
  incrementGuessesUsed,
  setTimer,
  updateRoomSettings,
  resetMultiplayerState,

  // History
  saveGameToHistory,
  loadGameHistory,
  clearGameHistory,
};
