import type { ClueData, ServerPlayerData, RoomStats, ReplayData } from './multiplayerTypes.js';

/**
 * Discriminated union for role-change state machine.
 *
 * Replaces five scattered variables (isChangingRole, changingTarget,
 * pendingRoleChange, roleChangeOperationId, roleChangeRevertFn)
 * with a single typed state that makes impossible states unrepresentable.
 *
 * Transitions:
 *   idle → changing_team     (user clicks team button)
 *   idle → changing_role     (user clicks role on current team)
 *   idle → team_then_role    (user clicks role on different team)
 *   changing_team → idle     (team confirmed, no pending role)
 *   team_then_role → changing_role  (team confirmed, sending queued role)
 *   changing_role → idle     (role confirmed)
 *   any non-idle → idle      (error, disconnect, or timeout)
 */
export type RoleChangeState =
    | { phase: 'idle' }
    | { phase: 'changing_team'; target: string; operationId: string; revertFn: () => void }
    | {
          phase: 'team_then_role';
          target: string;
          operationId: string;
          revertFn: () => void;
          pendingRole: 'spymaster' | 'clicker';
      }
    | { phase: 'changing_role'; target: string; operationId: string; revertFn: () => void };

export interface CachedElements {
    board: HTMLElement | null;
    roleBanner: HTMLElement | null;
    turnIndicator: HTMLElement | null;
    endTurnBtn: HTMLElement | null;
    spymasterBtn: HTMLElement | null;
    clickerBtn: HTMLElement | null;
    redTeamBtn: HTMLElement | null;
    blueTeamBtn: HTMLElement | null;
    spectateBtn: HTMLElement | null;
    redRemaining: HTMLElement | null;
    blueRemaining: HTMLElement | null;
    redTeamName: HTMLElement | null;
    blueTeamName: HTMLElement | null;
    srAnnouncements: HTMLElement | null;
    timerDisplay: HTMLElement | null;
    timerValue: HTMLElement | null;
}

/**
 * Per-game state synced from the server.
 *
 * NOTE: `gameMode` lives on `AppState.gameMode` (root level), NOT here,
 * because it is a room-level setting that persists across games — it is
 * set when the room is configured and does not change per-game.
 * Use the selectors `isDuetMode()` / `isMatchMode()` for mode checks.
 */
export interface GameState {
    words: string[];
    types: string[];
    revealed: boolean[];
    currentTurn: string;
    redScore: number;
    blueScore: number;
    redTotal: number;
    blueTotal: number;
    gameOver: boolean;
    winner: string | null;
    customWords: boolean;
    currentClue: ClueData | null;
    guessesUsed: number;
    // Multiplayer sync properties
    guessesAllowed: number;
    status: string;
    // Duet mode properties
    duetTypes: string[];
    timerTokens: number;
    greenFound: number;
    greenTotal: number;
    seed: string | number | null;
    // Match mode properties
    cardScores: (number | null)[];
    revealedBy: (string | null)[];
    matchRound: number;
    redMatchScore: number;
    blueMatchScore: number;
    roundHistory: RoundResult[];
    matchOver: boolean;
    matchWinner: string | null;
}

export interface RoundResult {
    roundNumber: number;
    roundWinner: string | null;
    redRoundScore: number;
    blueRoundScore: number;
    redBonusAwarded: boolean;
    blueBonusAwarded: boolean;
    endReason: string;
    completedAt: number;
}

export interface TimerState {
    active: boolean;
    endTime: number | null;
    duration: number | null;
    remainingSeconds: number | null;
    intervalId: ReturnType<typeof setInterval> | null;
    serverRemainingSeconds: number | null;
    countdownStartTime: number | null;
}

export interface NotificationPrefs {
    soundEnabled: boolean;
    tabNotificationEnabled: boolean;
}

export interface TeamNames {
    red: string;
    blue: string;
}

export interface AppState {
    // Cached DOM elements
    cachedElements: CachedElements;

    // Screen reader
    srAnnouncementTimeout: ReturnType<typeof setTimeout> | null;

    // Board
    boardInitialized: boolean;

    // Multiplayer
    isMultiplayerMode: boolean;
    multiplayerPlayers: ServerPlayerData[];
    currentMpMode: string;
    multiplayerListenersSetup: boolean;
    currentRoomId: string | null;

    // History / Replay
    currentReplayData: ReplayData | null;
    currentReplayIndex: number;
    replayPlaying: boolean;
    replayInterval: ReturnType<typeof setInterval> | null;
    historyDelegationSetup: boolean;

    // Modal
    activeModal: HTMLElement | null;
    previouslyFocusedElement: HTMLElement | null;
    modalListenersActive: boolean;

    // Words
    activeWords: string[];
    wordSource: string;
    wordListMode: string;
    teamNames: TeamNames;

    // Roles
    isHost: boolean;
    spymasterTeam: string | null;
    clickerTeam: string | null;
    playerTeam: string | null;
    roleChange: RoleChangeState;

    // Game state
    gameState: GameState;

    // Timer state
    timerState: TimerState;

    // Notifications
    notificationPrefs: NotificationPrefs;
    originalDocumentTitle: string;
    audioContext: AudioContext | null;

    // Debounce
    newGameDebounce: boolean;

    // Card reveal tracking
    lastRevealedIndex: number;
    lastRevealedWasCorrect: boolean;
    pendingUIUpdate: boolean;
    isRevealingCard: boolean;
    revealingCards: Set<number>;
    revealTimeouts: Map<number, ReturnType<typeof setTimeout>>;
    pendingRevealRAF: number | null;

    // i18n
    language: string;
    localizedDefaultWords: string[] | null;

    // Accessibility
    colorBlindMode: boolean;

    // Game mode — room-level setting, not per-game (see GameState JSDoc for rationale)
    gameMode: string;

    // Spectator/room stats (set dynamically by multiplayer sync)
    spectatorCount: number;
    roomStats: RoomStats | null;

    // Resync guard: when true, individual update events are deferred
    // until the full resync completes (prevents stale partial updates
    // from overriding fresh resync data)
    resyncInProgress: boolean;
}
