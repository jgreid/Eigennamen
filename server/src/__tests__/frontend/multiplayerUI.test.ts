/**
 * Frontend MultiplayerUI Module Tests
 *
 * Tests exports from src/frontend/multiplayerUI.ts:
 * updateMpIndicator, updateSharePanelMode, copyRoomCode, copyRoomId,
 * updatePlayerList, initPlayerListUI, updateRoomSettingsNavVisibility,
 * syncGameModeUI, updateDuetUI, updateDuetInfoBar,
 * updateSpectatorCount, updateRoomStats, handleSpectatorChatMessage,
 * confirmForfeit, closeForfeitConfirm, closeKickConfirm, confirmKickPlayer,
 * forfeitGame, updateForfeitButton, showReconnectionOverlay, hideReconnectionOverlay.
 * Test environment: jsdom
 */

const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
    showToast: mockShowToast
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        currentRoomId: 'TESTROOM',
        multiplayerPlayers: [],
        gameState: { gameOver: false, status: 'playing' },
        isHost: true,
        gameMode: 'classic',
        spectatorCount: 0,
        roomStats: null
    }
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key, params) => {
        if (key === 'multiplayer.playerCountOne') return '1 player';
        if (key === 'multiplayer.playerCount') return `${params?.count} players`;
        if (key === 'multiplayer.you') return 'You';
        if (key === 'multiplayer.host') return 'Host';
        if (key === 'multiplayer.offline') return 'Offline';
        if (key === 'multiplayer.kickPlayer') return 'Kick';
        if (key === 'multiplayer.kick') return 'Kick';
        if (key === 'forfeit.multiplayerOnly') return 'Multiplayer only';
        if (key === 'forfeit.hostOnly') return 'Host only';
        if (key === 'forfeit.gameAlreadyOver') return 'Game over';
        if (key === 'chat.spectatorMessage') return 'Spectator';
        return key;
    })
}));

jest.mock('../../frontend/utils', () => ({
    escapeHTML: jest.fn((str) => str),
    copyToClipboard: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../frontend/constants', () => ({
    VALIDATION: { NICKNAME_MIN_LENGTH: 2, NICKNAME_MAX_LENGTH: 20 },
    UI: { COPY_FEEDBACK_MS: 2000, RECONNECTION_TIMEOUT_MS: 15000 }
}));

jest.mock('../../frontend/chat', () => ({
    showChatPanel: jest.fn(),
    hideChatPanel: jest.fn(),
    initChat: jest.fn()
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: jest.fn(() => ({
        player: { isHost: true, nickname: 'TestHost' },
        getRoomCode: () => 'TESTROOM'
    })),
    isClientConnected: jest.fn(() => true)
}));

// Mock EigennamenClient global
(global as any).EigennamenClient = {
    player: { sessionId: 'session1', isHost: true, nickname: 'TestHost' },
    isConnected: jest.fn(() => true),
    kickPlayer: jest.fn(),
    forfeit: jest.fn(),
    setNickname: jest.fn(),
    sendSpectatorChat: jest.fn()
};

// Mock qrcode global
(global as any).qrcode = jest.fn();

import {
    updateMpIndicator, updateSharePanelMode,
    updatePlayerList, updateRoomSettingsNavVisibility,
    syncGameModeUI, updateDuetUI, updateDuetInfoBar,
    updateSpectatorCount, updateRoomStats, handleSpectatorChatMessage,
    confirmForfeit, closeForfeitConfirm, closeKickConfirm,
    forfeitGame, updateForfeitButton, showReconnectionOverlay, hideReconnectionOverlay
} from '../../frontend/multiplayerUI';
import { state } from '../../frontend/state';
import type { ServerPlayerData, ServerRoomData } from '../../frontend/multiplayerTypes';

describe('multiplayerUI module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        state.isMultiplayerMode = true;
        state.currentRoomId = 'TESTROOM';
        state.gameState.gameOver = false;
        state.isHost = true;
        state.gameMode = 'classic';
        state.spectatorCount = 0;
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('updateMpIndicator', () => {
        test('activates indicator when room is provided', () => {
            setupIndicatorDOM();
            const room: ServerRoomData = { code: 'TESTROOM' };
            const players: ServerPlayerData[] = [createPlayer('s1', 'Alice', true)];

            updateMpIndicator(room, players);

            expect(document.getElementById('mp-indicator')!.classList.contains('active')).toBe(true);
            expect(document.getElementById('mp-room-code')!.textContent).toBe('TESTROOM');
        });

        test('shows correct player count for single player', () => {
            setupIndicatorDOM();
            const room: ServerRoomData = { code: 'ROOM1' };
            const players: ServerPlayerData[] = [createPlayer('s1', 'Alice', true)];

            updateMpIndicator(room, players);

            expect(document.getElementById('mp-player-count')!.textContent).toBe('1 player');
        });

        test('shows correct player count for multiple players', () => {
            setupIndicatorDOM();
            const room: ServerRoomData = { code: 'ROOM1' };
            const players: ServerPlayerData[] = [
                createPlayer('s1', 'Alice', true),
                createPlayer('s2', 'Bob', false)
            ];

            updateMpIndicator(room, players);

            expect(document.getElementById('mp-player-count')!.textContent).toBe('2 players');
        });

        test('deactivates indicator when room is null', () => {
            setupIndicatorDOM();
            document.getElementById('mp-indicator')!.classList.add('active');

            updateMpIndicator(null, []);

            expect(document.getElementById('mp-indicator')!.classList.contains('active')).toBe(false);
        });

        test('shows multiplayer extra buttons row when in room', () => {
            setupIndicatorDOM();
            updateMpIndicator({ code: 'ROOM' }, [createPlayer('s1', 'A', true)]);

            expect(document.getElementById('mp-extra-buttons-row')!.style.display).toBe('flex');
        });

        test('hides multiplayer extra buttons row when not in room', () => {
            setupIndicatorDOM();
            updateMpIndicator(null, []);

            expect(document.getElementById('mp-extra-buttons-row')!.style.display).toBe('none');
        });
    });

    describe('updateSharePanelMode', () => {
        test('shows room code share in multiplayer mode', () => {
            setupShareDOM();
            updateSharePanelMode(true, 'MYROOM');

            expect(document.getElementById('mp-room-code-share')!.style.display).toBe('block');
            expect(document.getElementById('standalone-share')!.style.display).toBe('none');
            expect(document.getElementById('share-room-code')!.textContent).toBe('MYROOM');
        });

        test('shows standalone share in standalone mode', () => {
            setupShareDOM();
            updateSharePanelMode(false);

            expect(document.getElementById('mp-room-code-share')!.style.display).toBe('none');
            expect(document.getElementById('standalone-share')!.style.display).toBe('block');
        });
    });

    describe('updatePlayerList', () => {
        test('renders player names', () => {
            const ul = document.createElement('ul');
            const players: ServerPlayerData[] = [
                createPlayer('s1', 'Alice', true),
                createPlayer('s2', 'Bob', false)
            ];

            updatePlayerList(ul as HTMLUListElement, players);

            expect(ul.querySelectorAll('li')).toHaveLength(2);
            expect(ul.textContent).toContain('Alice');
            expect(ul.textContent).toContain('Bob');
        });

        test('marks current player with (You)', () => {
            const ul = document.createElement('ul');
            (global as any).EigennamenClient.player.sessionId = 'session1';
            const players: ServerPlayerData[] = [
                createPlayer('session1', 'Me', true),
                createPlayer('session2', 'Other', false)
            ];

            updatePlayerList(ul as HTMLUListElement, players);

            const firstItem = ul.querySelector('li')!;
            expect(firstItem.textContent).toContain('(You)');
        });

        test('shows host badge for host player', () => {
            const ul = document.createElement('ul');
            const players: ServerPlayerData[] = [createPlayer('s1', 'HostPlayer', true)];
            players[0].isHost = true;

            updatePlayerList(ul as HTMLUListElement, players);

            const badge = ul.querySelector('.host-badge');
            expect(badge).not.toBeNull();
            expect(badge!.textContent).toBe('Host');
        });

        test('shows disconnected style for offline player', () => {
            const ul = document.createElement('ul');
            const players: ServerPlayerData[] = [createPlayer('s1', 'Ghost', false)];
            players[0].connected = false;

            updatePlayerList(ul as HTMLUListElement, players);

            expect(ul.querySelector('li')!.className).toContain('player-disconnected');
        });

        test('shows kick button for non-self players when host', () => {
            const ul = document.createElement('ul');
            (global as any).EigennamenClient.player = { sessionId: 'host-session', isHost: true };
            const players: ServerPlayerData[] = [
                createPlayer('host-session', 'Host', true),
                createPlayer('guest-session', 'Guest', false)
            ];

            updatePlayerList(ul as HTMLUListElement, players);

            const kickButtons = ul.querySelectorAll('.btn-kick');
            expect(kickButtons).toHaveLength(1);
            expect((kickButtons[0] as HTMLElement).dataset.session).toBe('guest-session');
        });

        test('shows role text for players with roles', () => {
            const ul = document.createElement('ul');
            const players: ServerPlayerData[] = [createPlayer('s1', 'Spy', true)];
            players[0].role = 'spymaster';

            updatePlayerList(ul as HTMLUListElement, players);

            expect(ul.textContent).toContain('(spymaster)');
        });
    });

    describe('updateDuetUI', () => {
        test('adds duet-mode class when game is duet', () => {
            document.body.innerHTML = '<div class="main-content"></div><div id="duet-info-bar"></div>';
            state.gameMode = 'duet';

            updateDuetUI({ greenFound: 3, timerTokens: 5 } as any);

            expect(document.querySelector('.main-content')!.classList.contains('duet-mode')).toBe(true);
            expect(document.getElementById('duet-info-bar')!.style.display).toBe('flex');
        });

        test('removes duet-mode class when not duet', () => {
            document.body.innerHTML = '<div class="main-content duet-mode"></div><div id="duet-info-bar"></div>';
            state.gameMode = 'classic';

            updateDuetUI(null);

            expect(document.querySelector('.main-content')!.classList.contains('duet-mode')).toBe(false);
        });
    });

    describe('updateDuetInfoBar', () => {
        test('updates green found and timer tokens', () => {
            document.body.innerHTML = `
                <span id="duet-green-found">0</span>
                <span id="duet-timer-tokens">0</span>
            `;
            updateDuetInfoBar(7, 3);
            expect(document.getElementById('duet-green-found')!.textContent).toBe('7');
            expect(document.getElementById('duet-timer-tokens')!.textContent).toBe('3');
        });
    });

    describe('updateSpectatorCount', () => {
        test('updates spectator count display', () => {
            document.body.innerHTML = `
                <span id="mp-spectator-count">0</span>
                <div id="mp-spectator-inline" style="display: none"></div>
            `;
            updateSpectatorCount(5);
            expect(document.getElementById('mp-spectator-count')!.textContent).toBe('5');
            expect(document.getElementById('mp-spectator-inline')!.style.display).toBe('flex');
        });

        test('hides spectator section when count is 0', () => {
            document.body.innerHTML = `
                <span id="mp-spectator-count">3</span>
                <div id="mp-spectator-inline" style="display: flex"></div>
            `;
            updateSpectatorCount(0);
            expect(document.getElementById('mp-spectator-inline')!.style.display).toBe('none');
        });

        test('stores count in state', () => {
            document.body.innerHTML = '';
            updateSpectatorCount(10);
            expect(state.spectatorCount).toBe(10);
        });
    });

    describe('updateRoomStats', () => {
        test('updates spectator count from stats', () => {
            document.body.innerHTML = `
                <span id="mp-spectator-count">0</span>
                <div id="mp-spectator-inline"></div>
            `;
            updateRoomStats({ spectatorCount: 3 });
            expect(state.spectatorCount).toBe(3);
        });

        test('updates team counts', () => {
            document.body.innerHTML = `
                <span id="team-red-count">0</span>
                <span id="team-blue-count">0</span>
            `;
            updateRoomStats({ teams: { red: { total: 4 }, blue: { total: 3 } } });
            expect(document.getElementById('team-red-count')!.textContent).toBe('4');
            expect(document.getElementById('team-blue-count')!.textContent).toBe('3');
        });

        test('stores stats in state', () => {
            const stats = { spectatorCount: 2, teams: { red: { total: 3 }, blue: { total: 2 } } };
            updateRoomStats(stats);
            expect(state.roomStats).toBe(stats);
        });

        test('handles null stats gracefully', () => {
            expect(() => updateRoomStats(null as any)).not.toThrow();
        });
    });

    describe('handleSpectatorChatMessage', () => {
        test('adds spectator message to chat', () => {
            document.body.innerHTML = '<div id="chat-messages"></div>';
            handleSpectatorChatMessage({ text: 'Hello from spectator!', from: { nickname: 'Viewer' } });

            const messages = document.querySelectorAll('.chat-message');
            expect(messages).toHaveLength(1);
            expect(messages[0].textContent).toContain('Hello from spectator!');
            expect(messages[0].textContent).toContain('Viewer');
        });

        test('uses default sender name when none provided', () => {
            document.body.innerHTML = '<div id="chat-messages"></div>';
            handleSpectatorChatMessage({ text: 'Anonymous', from: {} });

            expect(document.querySelector('.chat-sender')!.textContent).toBe('Spectator');
        });

        test('ignores messages with invalid data', () => {
            document.body.innerHTML = '<div id="chat-messages"></div>';
            handleSpectatorChatMessage(null as any);
            expect(document.querySelectorAll('.chat-message')).toHaveLength(0);
        });
    });

    describe('syncGameModeUI', () => {
        test('checks correct radio for game mode', () => {
            document.body.innerHTML = `
                <input type="radio" name="gameMode" value="classic">
                <input type="radio" name="gameMode" value="duet">
            `;
            syncGameModeUI('duet');
            expect((document.querySelector('input[value="duet"]') as HTMLInputElement).checked).toBe(true);
        });

        test('handles empty game mode', () => {
            expect(() => syncGameModeUI('')).not.toThrow();
        });
    });

    describe('updateForfeitButton', () => {
        test('shows button for host during active game', () => {
            document.body.innerHTML = '<button id="btn-forfeit" style="display: none"></button>';
            state.isMultiplayerMode = true;
            state.gameState.gameOver = false;

            updateForfeitButton();

            expect(document.getElementById('btn-forfeit')!.style.display).toBe('inline-block');
        });

        test('hides button when game is over', () => {
            document.body.innerHTML = '<button id="btn-forfeit" style="display: inline-block"></button>';
            state.gameState.gameOver = true;

            updateForfeitButton();

            expect(document.getElementById('btn-forfeit')!.style.display).toBe('none');
        });
    });

    describe('confirmForfeit', () => {
        test('opens forfeit confirmation modal', () => {
            state.isMultiplayerMode = true;
            (global as any).EigennamenClient.player = { isHost: true };
            state.gameState.gameOver = false;

            confirmForfeit();

            expect(mockOpenModal).toHaveBeenCalledWith('confirm-forfeit-modal');
        });

        test('shows toast when not in multiplayer', () => {
            state.isMultiplayerMode = false;
            confirmForfeit();
            expect(mockShowToast).toHaveBeenCalledWith('Multiplayer only', 'warning');
        });

        test('shows toast when game is over', () => {
            state.gameState.gameOver = true;
            (global as any).EigennamenClient.player = { isHost: true };
            confirmForfeit();
            expect(mockShowToast).toHaveBeenCalledWith('Game over', 'info');
        });
    });

    describe('closeForfeitConfirm', () => {
        test('closes forfeit modal', () => {
            closeForfeitConfirm();
            expect(mockCloseModal).toHaveBeenCalledWith('confirm-forfeit-modal');
        });
    });

    describe('closeKickConfirm', () => {
        test('closes kick modal', () => {
            closeKickConfirm();
            expect(mockCloseModal).toHaveBeenCalledWith('confirm-kick-modal');
        });
    });

    describe('forfeitGame', () => {
        test('calls EigennamenClient.forfeit()', () => {
            state.isMultiplayerMode = true;
            (global as any).EigennamenClient.player = { isHost: true };
            state.gameState.gameOver = false;

            forfeitGame();

            expect((global as any).EigennamenClient.forfeit).toHaveBeenCalled();
        });

        test('does nothing when game is over', () => {
            state.gameState.gameOver = true;
            forfeitGame();
            expect((global as any).EigennamenClient.forfeit).not.toHaveBeenCalled();
        });
    });

    describe('showReconnectionOverlay', () => {
        test('shows overlay', () => {
            document.body.innerHTML = '<div id="reconnection-overlay" style="display: none"></div>';
            showReconnectionOverlay();
            expect(document.getElementById('reconnection-overlay')!.style.display).toBe('block');
        });

        test('sets fallback timeout to hide overlay', () => {
            document.body.innerHTML = '<div id="reconnection-overlay" style="display: none"></div>';
            showReconnectionOverlay();

            // Advance timer past 15s timeout
            jest.advanceTimersByTime(16000);

            expect(document.getElementById('reconnection-overlay')!.style.display).toBe('none');
        });
    });

    describe('hideReconnectionOverlay', () => {
        test('hides overlay', () => {
            document.body.innerHTML = '<div id="reconnection-overlay" style="display: block"></div>';
            hideReconnectionOverlay();
            expect(document.getElementById('reconnection-overlay')!.style.display).toBe('none');
        });
    });

    describe('updateRoomSettingsNavVisibility', () => {
        test('shows nav item for multiplayer host', () => {
            document.body.innerHTML = '<div id="nav-room-settings" style="display: none"></div>';
            state.isMultiplayerMode = true;

            updateRoomSettingsNavVisibility();

            expect(document.getElementById('nav-room-settings')!.style.display).toBe('flex');
        });

        test('hides nav item when not in multiplayer', () => {
            document.body.innerHTML = '<div id="nav-room-settings" style="display: flex"></div>';
            state.isMultiplayerMode = false;

            updateRoomSettingsNavVisibility();

            expect(document.getElementById('nav-room-settings')!.style.display).toBe('none');
        });
    });
});

// Helpers

function setupIndicatorDOM(): void {
    document.body.innerHTML = `
        <div id="mp-indicator"></div>
        <span id="mp-room-code"></span>
        <span id="mp-player-count"></span>
        <div id="mp-player-list"></div>
        <ul id="mp-players-ul"></ul>
        <div id="mp-extra-buttons-row" style="display: none"></div>
    `;
}

function setupShareDOM(): void {
    document.body.innerHTML = `
        <div id="mp-room-code-share" style="display: none"></div>
        <div id="standalone-share" style="display: block"></div>
        <span id="share-room-code"></span>
        <span id="share-server-url"></span>
    `;
}

function createPlayer(
    sessionId: string, nickname: string, isHost: boolean,
    team: string | null = null, role: string | null = null
): ServerPlayerData {
    return { sessionId, nickname, isHost, team, role, connected: true };
}
