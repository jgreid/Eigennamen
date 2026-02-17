/**
 * Frontend Roles Module Tests
 *
 * Tests team/role management, role banner updates, control state, and standalone mode role changes.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, _params?: Record<string, string>) => key,
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: () => false,
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
}));

import {
    clearRoleChange,
    revertAndClearRoleChange,
    updateRoleBanner,
    updateControls,
    setTeam,
    setSpymaster,
    setClicker,
    setSpymasterCurrent,
    setClickerCurrent,
} from '../../frontend/roles';
import { state } from '../../frontend/state';
import { renderBoard } from '../../frontend/board';

function setupRolesDOM() {
    document.body.innerHTML = `
        <div id="role-banner"></div>
        <button id="btn-end-turn">End Turn</button>
        <button id="btn-spymaster">Spymaster</button>
        <button id="btn-clicker">Clicker</button>
        <button id="btn-team-red">Red</button>
        <button id="btn-team-blue">Blue</button>
        <button id="btn-spectate">Spectate</button>
        <div id="role-hint"></div>
        <div id="sr-announcements" aria-live="assertive"></div>
    `;
    state.cachedElements.roleBanner = document.getElementById('role-banner');
    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
}

beforeEach(() => {
    setupRolesDOM();
    state.isMultiplayerMode = false;
    state.isHost = false;
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.roleChange = { phase: 'idle' };
    state.multiplayerPlayers = [];
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.gameState.currentTurn = 'red';
    state.gameState.gameOver = false;
    (renderBoard as jest.Mock).mockClear();
});

// ========== ROLE CHANGE STATE MACHINE ==========

describe('clearRoleChange', () => {
    test('resets phase to idle', () => {
        state.roleChange = { phase: 'changing_team', target: 'red', operationId: '1', revertFn: () => {} };
        clearRoleChange();
        expect(state.roleChange.phase).toBe('idle');
    });
});

describe('revertAndClearRoleChange', () => {
    test('calls revertFn and resets to idle', () => {
        const revertFn = jest.fn();
        state.roleChange = { phase: 'changing_team', target: 'red', operationId: '1', revertFn };
        revertAndClearRoleChange();
        expect(revertFn).toHaveBeenCalled();
        expect(state.roleChange.phase).toBe('idle');
    });

    test('does not call revertFn when already idle', () => {
        state.roleChange = { phase: 'idle' };
        expect(() => revertAndClearRoleChange()).not.toThrow();
        expect(state.roleChange.phase).toBe('idle');
    });
});

// ========== ROLE BANNER ==========

describe('updateRoleBanner', () => {
    test('shows spymaster banner for red team spymaster', () => {
        state.spymasterTeam = 'red';
        state.playerTeam = 'red';
        updateRoleBanner();

        const banner = document.getElementById('role-banner')!;
        expect(banner.innerHTML).toContain('Red');
        expect(banner.className).toContain('role-banner');
    });

    test('shows clicker banner for blue team clicker', () => {
        state.clickerTeam = 'blue';
        state.playerTeam = 'blue';
        updateRoleBanner();

        const banner = document.getElementById('role-banner')!;
        expect(banner.innerHTML).toContain('Blue');
    });

    test('shows host badge when player is host', () => {
        state.isHost = true;
        state.spymasterTeam = 'red';
        state.playerTeam = 'red';
        updateRoleBanner();

        const banner = document.getElementById('role-banner')!;
        expect(banner.innerHTML).toContain('host-badge');
    });

    test('shows host spectator when host has no role', () => {
        state.isHost = true;
        state.playerTeam = null;
        state.spymasterTeam = null;
        state.clickerTeam = null;
        updateRoleBanner();

        const banner = document.getElementById('role-banner')!;
        expect(banner.className).toContain('host');
        expect(banner.innerHTML).toContain('host-badge');
    });

    test('shows viewer/spectator for non-host unaffiliated', () => {
        state.isHost = false;
        state.playerTeam = null;
        updateRoleBanner();

        const banner = document.getElementById('role-banner')!;
        expect(banner.className).toContain('viewer');
    });

    test('handles missing banner element', () => {
        state.cachedElements.roleBanner = null;
        document.getElementById('role-banner')!.remove();
        expect(() => updateRoleBanner()).not.toThrow();
    });
});

// ========== UPDATE CONTROLS ==========

describe('updateControls', () => {
    test('enables end turn button for active clicker', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        updateControls();

        const btn = document.getElementById('btn-end-turn') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        expect(btn.classList.contains('can-act')).toBe(true);
    });

    test('disables end turn button when not active clicker', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'blue';
        updateControls();

        const btn = document.getElementById('btn-end-turn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    test('disables end turn when game is over', () => {
        state.clickerTeam = 'red';
        state.gameState.currentTurn = 'red';
        state.gameState.gameOver = true;
        updateControls();

        const btn = document.getElementById('btn-end-turn') as HTMLButtonElement;
        expect(btn.disabled).toBe(true);
    });

    test('highlights selected red team button', () => {
        state.playerTeam = 'red';
        updateControls();

        const btn = document.getElementById('btn-team-red')!;
        expect(btn.classList.contains('selected')).toBe(true);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    test('highlights selected blue team button', () => {
        state.playerTeam = 'blue';
        updateControls();

        const btn = document.getElementById('btn-team-blue')!;
        expect(btn.classList.contains('selected')).toBe(true);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
    });

    test('highlights spectate button when unaffiliated', () => {
        state.playerTeam = null;
        updateControls();

        const btn = document.getElementById('btn-spectate')!;
        expect(btn.classList.contains('active')).toBe(true);
    });

    test('disables role buttons when not on a team', () => {
        state.playerTeam = null;
        updateControls();

        const spy = document.getElementById('btn-spymaster') as HTMLButtonElement;
        const clicker = document.getElementById('btn-clicker') as HTMLButtonElement;
        expect(spy.disabled).toBe(true);
        expect(clicker.disabled).toBe(true);
    });

    test('enables role buttons when on a team', () => {
        state.playerTeam = 'red';
        updateControls();

        const spy = document.getElementById('btn-spymaster') as HTMLButtonElement;
        const clicker = document.getElementById('btn-clicker') as HTMLButtonElement;
        expect(spy.disabled).toBe(false);
        expect(clicker.disabled).toBe(false);
    });

    test('marks spymaster button active when player is spymaster', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        updateControls();

        const spy = document.getElementById('btn-spymaster') as HTMLButtonElement;
        expect(spy.classList.contains('active')).toBe(true);
        expect(spy.getAttribute('aria-pressed')).toBe('true');
    });

    test('marks clicker button active when player is clicker', () => {
        state.playerTeam = 'blue';
        state.clickerTeam = 'blue';
        updateControls();

        const clicker = document.getElementById('btn-clicker') as HTMLButtonElement;
        expect(clicker.classList.contains('active')).toBe(true);
    });

    test('shows role hint to select team when no team', () => {
        state.playerTeam = null;
        updateControls();

        const hint = document.getElementById('role-hint')!;
        expect(hint.textContent).toBe('roles.selectTeamFirst');
        expect(hint.classList.contains('hidden')).toBe(false);
    });

    test('hides role hint when role is set', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        updateControls();

        const hint = document.getElementById('role-hint')!;
        expect(hint.classList.contains('hidden')).toBe(true);
    });

    test('shows choose role hint when on team but no role', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = null;
        state.clickerTeam = null;
        updateControls();

        const hint = document.getElementById('role-hint')!;
        expect(hint.textContent).toBe('roles.chooseRole');
    });

    test('adds loading class when role change in progress', () => {
        state.roleChange = { phase: 'changing_team', target: 'red', operationId: '1', revertFn: () => {} };
        updateControls();

        const btn = document.getElementById('btn-team-red')!;
        expect(btn.classList.contains('loading')).toBe(true);
    });

    test('sets end turn tooltip for game over', () => {
        state.gameState.gameOver = true;
        updateControls();

        const btn = document.getElementById('btn-end-turn')!;
        expect(btn.title).toBe('roles.gameIsOver');
    });
});

// ========== SET TEAM (STANDALONE) ==========

describe('setTeam (standalone mode)', () => {
    test('sets player team', () => {
        setTeam('red');
        expect(state.playerTeam).toBe('red');
    });

    test('clears spymaster/clicker when switching teams', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        state.clickerTeam = null;

        setTeam('blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });

    test('preserves roles when setting same team', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';

        setTeam('red');
        expect(state.spymasterTeam).toBe('red');
    });

    test('sets team to null for spectating', () => {
        state.playerTeam = 'red';
        setTeam(null);
        expect(state.playerTeam).toBeNull();
    });

    test('calls renderBoard after team change', () => {
        setTeam('blue');
        expect(renderBoard).toHaveBeenCalled();
    });
});

// ========== SET SPYMASTER (STANDALONE) ==========

describe('setSpymaster (standalone mode)', () => {
    test('sets spymaster for a team', () => {
        setSpymaster('red');
        expect(state.spymasterTeam).toBe('red');
        expect(state.playerTeam).toBe('red');
    });

    test('clears clicker when becoming spymaster', () => {
        state.playerTeam = 'red';
        state.clickerTeam = 'red';
        setSpymaster('red');
        expect(state.spymasterTeam).toBe('red');
        expect(state.clickerTeam).toBeNull();
    });

    test('toggles off spymaster when already spymaster for same team', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        setSpymaster('red');
        expect(state.spymasterTeam).toBeNull();
    });

    test('switches team when becoming spymaster for other team', () => {
        state.playerTeam = 'red';
        setSpymaster('blue');
        expect(state.playerTeam).toBe('blue');
        expect(state.spymasterTeam).toBe('blue');
    });
});

// ========== SET CLICKER (STANDALONE) ==========

describe('setClicker (standalone mode)', () => {
    test('sets clicker for a team', () => {
        setClicker('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.playerTeam).toBe('blue');
    });

    test('clears spymaster when becoming clicker', () => {
        state.playerTeam = 'blue';
        state.spymasterTeam = 'blue';
        setClicker('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });

    test('toggles off clicker when already clicker for same team', () => {
        state.playerTeam = 'blue';
        state.clickerTeam = 'blue';
        setClicker('blue');
        expect(state.clickerTeam).toBeNull();
    });
});

// ========== CURRENT ROLE WRAPPERS ==========

describe('setSpymasterCurrent', () => {
    test('sets spymaster for current team', () => {
        state.playerTeam = 'red';
        setSpymasterCurrent();
        expect(state.spymasterTeam).toBe('red');
    });

    test('shows toast when no team selected', () => {
        state.playerTeam = null;
        setSpymasterCurrent();
        // Should not crash; the toast is shown internally
        expect(state.spymasterTeam).toBeNull();
    });
});

describe('setClickerCurrent', () => {
    test('sets clicker for current team', () => {
        state.playerTeam = 'blue';
        setClickerCurrent();
        expect(state.clickerTeam).toBe('blue');
    });

    test('shows toast when no team selected', () => {
        state.playerTeam = null;
        setClickerCurrent();
        expect(state.clickerTeam).toBeNull();
    });
});
