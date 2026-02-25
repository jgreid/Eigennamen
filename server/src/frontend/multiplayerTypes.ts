export interface ServerPlayerData {
    sessionId: string;
    nickname: string;
    team: string | null;
    role: string | null;
    isHost: boolean;
    connected: boolean;
}

export interface ServerRoomData {
    code: string;
    status?: string;
    settings?: Record<string, unknown>;
}

export interface ServerGameData {
    words?: string[];
    types?: string[];
    revealed?: boolean[];
    currentTurn?: string;
    redScore?: number;
    blueScore?: number;
    redTotal?: number;
    blueTotal?: number;
    gameOver?: boolean;
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
}

export interface ClueData {
    word: string;
    number: number;
    team: string;
    spymaster?: string;
    guessesAllowed?: number;
}

export interface JoinCreateResult {
    room?: ServerRoomData;
    player?: ServerPlayerData;
    players?: ServerPlayerData[];
    you?: ServerPlayerData;
    game?: ServerGameData;
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
    remainingSeconds?: number;
    duration?: number;
}

export interface SettingsUpdatedData {
    settings?: {
        gameMode?: string;
        [key: string]: unknown;
    };
}

export interface StatsUpdatedData {
    stats?: RoomStats;
}

export interface SpectatorChatData {
    message: string;
    sender?: {
        nickname?: string;
    };
}

// Chat message data from server
export interface ChatMessageData {
    from: {
        sessionId: string;
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
    newHostSessionId?: string;
    newHostNickname?: string;
}

export interface PlayerUpdatedData {
    sessionId?: string;
    changes?: Partial<ServerPlayerData>;
}

export interface ReconnectionData {
    room?: ServerRoomData;
    players?: ServerPlayerData[];
    game?: ServerGameData;
    you?: ServerPlayerData;
    error?: ServerErrorData;
}

export interface GameStartedData {
    game?: ServerGameData;
    gameMode?: string;
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

export interface SpymasterViewData {
    types?: string[];
}

export interface PlayerJoinedData {
    players?: ServerPlayerData[];
    player?: ServerPlayerData;
}

export interface PlayerLeftData {
    players?: ServerPlayerData[];
    sessionId?: string;
    nickname?: string;
}

export interface PlayerDisconnectedData {
    sessionId?: string;
    nickname?: string;
}

export interface KickedData {
    reason?: string;
}

export interface PlayerKickedData {
    sessionId?: string;
    nickname?: string;
}

export interface HistoryResultData {
    games?: GameHistoryEntry[];
}

export interface RoomWarningData {
    code?: string;
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
    };
}

export interface ReplayData {
    id?: string;
    finalState?: {
        winner?: string;
    };
    teamNames?: Record<string, string>;
    duration?: number;
    totalMoves?: number;
    initialBoard?: {
        words?: string[];
        types?: string[];
    };
    events?: ReplayEvent[];
    replay?: unknown;
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
}
