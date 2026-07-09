export interface ServerPlayerData {
    /** Opaque public player id — the only peer identity the server sends (N1) */
    playerId: string;
    /** Own sessionId — present ONLY on self payloads (room:created player / room:joined you) */
    sessionId?: string;
    nickname: string;
    team: 'red' | 'blue' | null;
    role: 'spymaster' | 'clicker' | 'spectator' | null;
    isHost: boolean;
    connected: boolean;
    isBot?: boolean;
}

export interface ServerRoomData {
    code: string;
    status?: string;
    settings?: Record<string, unknown>;
}

export interface ServerGameData {
    id?: string;
    words?: string[];
    types?: string[];
    revealed?: boolean[];
    currentTurn?: string;
    redScore?: number;
    blueScore?: number;
    redTotal?: number;
    blueTotal?: number;
    gameOver?: boolean;
    paused?: boolean;
    winner?: string | null;
    seed?: string | number;
    currentClue?: ClueData | null;
    guessesUsed?: number;
    guessesAllowed?: number;
    gameMode?: string;
    duetTypes?: string[];
    timerTokens?: number;
    greenFound?: number;
    greenTotal?: number;
    // Match mode
    cardScores?: (number | null)[];
    revealedBy?: (string | null)[];
    matchRound?: number;
    redMatchScore?: number;
    blueMatchScore?: number;
    roundHistory?: RoundResultData[];
    matchOver?: boolean;
    matchWinner?: string | null;
}

export interface ClueData {
    word: string;
    number: number;
    team: string;
    spymaster?: string;
    guessesAllowed?: number;
}

export interface ClueGivenData {
    word: string;
    number: number;
    team: string;
    guessesAllowed?: number;
    spymaster?: { playerId: string; nickname: string };
}

export interface BotSuggestionData {
    team: string;
    clue: { word: string; number: number };
    advisor: { playerId: string; nickname: string };
    suggestions: { index: number; confidence: number; reason: string; warning?: string }[];
}

export interface JoinCreateResult {
    room?: ServerRoomData;
    player?: ServerPlayerData;
    players?: ServerPlayerData[];
    you?: ServerPlayerData;
    game?: ServerGameData;
    /** Per-session auth secret required by the socket handshake to re-adopt this session (N1) */
    sessionToken?: string;
}

export interface CardRevealedData {
    index?: number;
    word?: string;
    type?: string;
    redScore?: number;
    blueScore?: number;
    gameOver?: boolean;
    winner?: string | null;
    currentTurn?: string;
    guessesUsed?: number;
    guessesAllowed?: number;
    turnEnded?: boolean;
    timerTokens?: number;
    greenFound?: number;
    // Match mode
    cardScore?: number;
    redMatchScore?: number;
    blueMatchScore?: number;
}

export interface RoomStats {
    spectatorCount?: number;
    teams?: {
        red?: { total: number };
        blue?: { total: number };
    };
}

export interface DOMListenerEntry {
    element: Element;
    event: string;
    handler: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
}

export interface ServerErrorData {
    code?: string;
    message?: string;
}

export interface TimerEventData {
    active?: boolean;
    remainingSeconds?: number;
    remaining?: number;
    duration?: number;
    endTime?: number;
    /** Present on timer:status — whether the game (and thus the timer) is paused (N14). */
    isPaused?: boolean;
}

export interface SettingsUpdatedData {
    settings?: {
        gameMode?: string;
        turnTimer?: number | null;
        allowSpectators?: boolean;
        [key: string]: unknown;
    };
}

export interface StatsUpdatedData {
    stats?: RoomStats;
}

export interface SpectatorChatData {
    text: string;
    from?: {
        playerId?: string;
        nickname?: string;
        team?: string;
        role?: string;
    };
    timestamp?: number;
}

// Spectator join-request flow (F6)
export interface SpectatorJoinRequestData {
    requesterId: string;
    requesterNickname: string;
    team: 'red' | 'blue';
    timestamp?: number;
}

export interface SpectatorJoinApprovedData {
    team: 'red' | 'blue';
    message?: string;
    timestamp?: number;
}

export interface SpectatorJoinDeniedData {
    message?: string;
    timestamp?: number;
}

// Chat message data from server
export interface ChatMessageData {
    from: {
        playerId: string;
        nickname: string;
        team: string | null;
        role: string;
    };
    text: string;
    teamOnly?: boolean;
    spectatorOnly?: boolean;
    timestamp: number;
}

export interface HostChangedData {
    newHostPlayerId?: string;
    newHostNickname?: string;
}

export interface PlayerUpdatedData {
    playerId?: string;
    changes?: Partial<ServerPlayerData>;
}

export interface ReconnectionData {
    room?: ServerRoomData;
    players?: ServerPlayerData[];
    game?: ServerGameData;
    you?: ServerPlayerData;
    /** Per-session auth secret required by the socket handshake to re-adopt this session (N1) */
    sessionToken?: string;
    error?: ServerErrorData;
}

export interface GameStartedData {
    game?: ServerGameData;
    gameMode?: string;
    isNextRound?: boolean;
}

export interface TurnEndedData {
    currentTurn?: string;
}

export interface GameOverData {
    winner?: string | null;
    types?: string[];
    duetTypes?: string[];
    reason?: string;
}

export interface GamePausedData {
    pausedBy?: string;
}

export interface GameResumedData {
    resumedBy?: string;
}

export interface RoundResultData {
    roundNumber: number;
    roundWinner: string | null;
    redRoundScore: number;
    blueRoundScore: number;
    redBonusAwarded: boolean;
    blueBonusAwarded: boolean;
    endReason: string;
    completedAt: number;
}

export interface RoundEndedData {
    roundResult: RoundResultData;
    redMatchScore: number;
    blueMatchScore: number;
    matchRound: number;
}

export interface MatchOverData {
    roundResult: RoundResultData;
    redMatchScore: number;
    blueMatchScore: number;
    matchWinner: string;
}

export interface ReadyCheckPlayer {
    playerId: string;
    nickname: string;
    ready: boolean;
}

export interface ReadyStatusData {
    players?: ReadyCheckPlayer[];
    startedBy?: string;
    timeout?: number;
    playerReady?: {
        playerId: string;
        nickname: string;
    };
}

export interface SpymasterViewData {
    types?: string[];
    duetTypes?: string[];
    cardScores?: number[];
}

export interface PlayerJoinedData {
    players?: ServerPlayerData[];
    player?: ServerPlayerData;
}

export interface PlayerLeftData {
    players?: ServerPlayerData[];
    playerId?: string;
    nickname?: string;
}

export interface PlayerDisconnectedData {
    playerId?: string;
    nickname?: string;
}

export interface KickedData {
    reason?: string;
}

export interface PlayerKickedData {
    playerId?: string;
    nickname?: string;
}

export interface HistoryResultData {
    history?: GameHistoryEntry[];
}

export interface RoomWarningData {
    code?: string;
    message?: string;
    team?: 'red' | 'blue';
}

export interface AckResult {
    error?: { code?: string; message?: string };
}

export interface ReplayEvent {
    type: string;
    data?: {
        index?: number;
        type?: string;
        team?: string;
        word?: string;
        number?: number;
        winner?: string;
        // Present at runtime for the recap (server sends them; previously untyped).
        spymaster?: string;
        guessNumber?: number;
        guessesAllowed?: number;
        player?: string;
        fromTeam?: string;
        toTeam?: string;
        forfeitingTeam?: string;
    };
}

export interface ReplayData {
    id?: string;
    finalState?: {
        winner?: string | null;
        redScore?: number;
        blueScore?: number;
    };
    teamNames?: Record<string, string>;
    duration?: number;
    totalMoves?: number;
    totalClues?: number;
    /** Provenance: the saved word list this game was played with (if any). */
    wordListId?: string | null;
    wordListName?: string | null;
    initialBoard?: {
        words?: string[];
        types?: string[];
    };
    events?: ReplayEvent[];
}

export interface GameHistoryEntry {
    id: string;
    timestamp?: string | number;
    winner?: string;
    teamNames?: Record<string, string>;
    redScore?: number;
    blueScore?: number;
    moveCount?: number;
    clueCount?: number;
    endReason?: string;
    duration?: number;
}
