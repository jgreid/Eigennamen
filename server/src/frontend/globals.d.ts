/**
 * Global type declarations for frontend modules.
 *
 * These types describe globals loaded via <script> tags before the
 * ES module entry-point (app.ts).
 */

/* ---------- EigennamenClient (socket-client.js) ---------- */

interface EigennamenPlayer {
    sessionId: string;
    nickname: string;
    team: 'red' | 'blue' | null;
    role: 'spymaster' | 'clicker' | 'spectator' | null;
    isHost: boolean;
    connected: boolean;
}

interface AckResult {
    error?: { code?: string; message?: string };
}

interface EigennamenClientAPI {
    socket: unknown;
    sessionId: string | null;
    roomCode: string | null;
    player: EigennamenPlayer | null;
    connected: boolean;

    // Connection
    isConnected(): boolean;
    isInRoom(): boolean;
    connect(url?: string, options?: Record<string, unknown>): Promise<void>;

    // Room management
    joinRoom(roomId: string, nickname: string): Promise<import('./multiplayerTypes.js').JoinCreateResult>;
    createRoom(options: {
        roomId: string;
        nickname: string;
    }): Promise<import('./multiplayerTypes.js').JoinCreateResult>;
    leaveRoom(): void;
    getRoomCode(): string | null;
    requestResync(): Promise<void>;

    // Game actions
    startGame(options: Record<string, unknown>): void;
    nextRound(): void;
    revealCard(index: number): void;
    endTurn(): void;
    forfeit(): void;
    abandonGame(): void;

    // Host queries
    isHost(): boolean;

    // Player actions
    setTeam(team: string | null, ack?: (result: AckResult) => void): void;
    setRole(role: string, ack?: (result: AckResult) => void): void;
    setTeamRole(team: string, role: string, ack?: (result: AckResult) => void): void;
    setNickname(nickname: string): void;
    kickPlayer(sessionId: string): void;

    // Room settings
    updateSettings(settings: Record<string, unknown>): void;

    // History / Replay
    getGameHistory(limit: number): void;
    getReplay(gameId: string): void;
    clearHistory(): void;

    // Chat
    sendMessage(text: string, teamOnly: boolean): void;
    sendSpectatorChat(message: string): void;

    // Event emitter (callback uses any[] due to event emitter pattern)
    on(event: string, callback: (...args: never[]) => void): void;
    once(event: string, callback: (...args: never[]) => void): void;
    off(event: string): void;
}

declare const EigennamenClient: EigennamenClientAPI;

/* ---------- Socket.io (socket.io.min.js) ---------- */

interface IoFunction {
    (url?: string, options?: Record<string, unknown>): unknown;
    Manager: new (url?: string, options?: Record<string, unknown>) => unknown;
    Socket: new (...args: unknown[]) => unknown;
    connect: IoFunction;
}
declare const io: IoFunction;

/* ---------- Build-time constants (injected by esbuild define) ---------- */

/** Application version from package.json, injected at build time */
declare const __APP_VERSION__: string;

/* ---------- Window extensions ---------- */

interface Window {
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
    __eigennamenDebug?: Record<string, unknown>;
}
