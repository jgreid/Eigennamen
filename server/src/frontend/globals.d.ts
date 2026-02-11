/**
 * Global type declarations for frontend modules.
 *
 * These types describe globals loaded via <script> tags before the
 * ES module entry-point (app.ts).
 */

/* ---------- CodenamesClient (socket-client.js) ---------- */

interface CodenamesPlayer {
    sessionId: string;
    nickname: string;
    team: string | null;
    role: string | null;
    isHost: boolean;
    connected: boolean;
}

interface AckResult {
    error?: { code?: string; message?: string };
}

interface CodenamesClientAPI {
    socket: unknown;
    sessionId: string | null;
    roomCode: string | null;
    player: CodenamesPlayer | null;
    connected: boolean;

    // Connection
    isConnected(): boolean;
    isInRoom(): boolean;
    connect(url?: string, options?: Record<string, unknown>): Promise<void>;

    // Room management
    joinRoom(roomId: string, nickname: string): Promise<import('./multiplayerTypes.js').JoinCreateResult>;
    createRoom(options: { roomId: string; nickname: string }): Promise<import('./multiplayerTypes.js').JoinCreateResult>;
    leaveRoom(): void;
    getRoomCode(): string | null;
    requestResync(): Promise<void>;

    // Game actions
    startGame(options: Record<string, unknown>): void;
    revealCard(index: number): void;
    endTurn(): void;
    forfeit(): void;

    // Player actions
    setTeam(team: string | null, ack?: (result: AckResult) => void): void;
    setRole(role: string, ack?: (result: AckResult) => void): void;
    setNickname(nickname: string): void;
    kickPlayer(sessionId: string): void;

    // Room settings
    updateSettings(settings: Record<string, unknown>): void;

    // History / Replay
    getGameHistory(limit: number): void;
    getReplay(gameId: string): void;

    // Chat
    sendSpectatorChat(message: string): void;

    // Event emitter (callback uses any[] due to event emitter pattern)
    on(event: string, callback: (...args: never[]) => void): void;
    off(event: string): void;
}

declare const CodenamesClient: CodenamesClientAPI;

/* ---------- qrcode (qrcode.min.js) ---------- */

interface QRCode {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
}

declare function qrcode(typeNumber: number, errorCorrection: string): QRCode;

/* ---------- Socket.io (socket.io.min.js) ---------- */

declare function io(url?: string, options?: Record<string, unknown>): unknown;

/* ---------- Window extensions ---------- */

interface Window {
    AudioContext: typeof AudioContext;
    webkitAudioContext: typeof AudioContext;
    __codenamesDebug?: Record<string, unknown>;
}
