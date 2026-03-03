import { state, ROLE_BANNER_CONFIG } from './state.js';
import { isSpymaster, isClicker as isClickerSelector, canActAsClicker, isClickerFallback } from './store/selectors.js';
import { escapeHTML } from './utils.js';
import { showToast, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';
import { t } from './i18n.js';
import { logger } from './logger.js';
import { isClientConnected } from './clientAccessor.js';
import { getErrorMessage } from './handlers/errorMessages.js';

// ---- Role-change state machine helpers ----

/** Absolute failsafe: if *any* role-change operation is stuck for this
 *  long (regardless of operation ID), force-clear it so the UI unblocks.
 *  The per-operation 5 s timeouts handle normal lost-ack cases; this is
 *  purely a safety-net for unexpected state-machine stalls. */
const ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS = 10_000;
let absoluteTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

function startAbsoluteTimeout(): void {
    clearAbsoluteTimeout();
    absoluteTimeoutHandle = setTimeout(() => {
        if (state.roleChange.phase !== 'idle') {
            logger.warn('Role change absolute failsafe fired — forcing idle');
            clearRoleChange();
            updateControls();
            showToast(t('roles.changeTimeout'), 'warning');
        }
    }, ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS);
}

function clearAbsoluteTimeout(): void {
    if (absoluteTimeoutHandle !== null) {
        clearTimeout(absoluteTimeoutHandle);
        absoluteTimeoutHandle = null;
    }
}

function generateOperationId(): string {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/** Transition to idle, discarding any in-flight state. */
export function clearRoleChange(): void {
    clearAbsoluteTimeout();
    state.roleChange = { phase: 'idle' };
}

/** Revert optimistic UI then transition to idle. */
export function revertAndClearRoleChange(): void {
    if (state.roleChange.phase !== 'idle') {
        try {
            state.roleChange.revertFn();
        } catch (err) {
            logger.error('revertAndClearRoleChange: revertFn threw', err);
        }
    }
    state.roleChange = { phase: 'idle' };
}

/** True when any role-change operation is in progress. */
function isChangingRole(): boolean {
    return state.roleChange.phase !== 'idle';
}

/** The UI target being changed (for loading spinners). */
function changingTarget(): string | null {
    return state.roleChange.phase !== 'idle' ? state.roleChange.target : null;
}

/** The pending role to apply after a team change, if any. */
function pendingRole(): string | null {
    return state.roleChange.phase === 'team_then_role' ? state.roleChange.pendingRole : null;
}

export function updateRoleBanner(): void {
    const banner = state.cachedElements.roleBanner || document.getElementById('role-banner');
    if (!banner) return;

    const hostBadge = state.isHost ? `<span class="host-badge">${escapeHTML(t('multiplayer.host'))}</span>` : '';

    // Determine role and team for config lookup
    let role: string | null = null;
    let team: string | null = null;

    if (state.spymasterTeam) {
        role = 'spymaster';
        team = state.spymasterTeam;
    } else if (state.clickerTeam) {
        role = 'clicker';
        team = state.clickerTeam;
    } else if (state.playerTeam) {
        role = 'spectator';
        team = state.playerTeam;
    }

    // Use config if role/team are set, otherwise fallback to host/viewer
    // Validate team is 'red' or 'blue' before accessing teamNames
    if (role && team && (team === 'red' || team === 'blue') && ROLE_BANNER_CONFIG[role]) {
        const config = ROLE_BANNER_CONFIG[role];
        banner.className = `role-banner ${config[team]}`;
        // Use nullish coalescing in case teamNames doesn't have the team key
        banner.innerHTML = `<strong>${escapeHTML(state.teamNames[team] || (team === 'red' ? 'Red' : 'Blue'))}</strong> ${escapeHTML(config.label)}${hostBadge}`;
    } else if (state.isHost) {
        banner.className = 'role-banner host';
        banner.innerHTML = `<span class="host-badge">${escapeHTML(t('multiplayer.host'))}</span> ${escapeHTML(t('roles.spectator'))}`;
    } else {
        banner.className = 'role-banner viewer';
        banner.innerHTML = escapeHTML(t('roles.spectator'));
    }
}

export function updateControls(): void {
    const endTurnBtn = document.getElementById('btn-end-turn') as HTMLButtonElement | null;
    const spymasterBtn = document.getElementById('btn-spymaster') as HTMLButtonElement | null;
    const clickerBtn = document.getElementById('btn-clicker') as HTMLButtonElement | null;
    const redTeamBtn = document.getElementById('btn-team-red');
    const blueTeamBtn = document.getElementById('btn-team-blue');
    const roleHint = document.getElementById('role-hint');

    // Clicker (or fallback) can end turn when it's their team's turn
    const clickerCanAct = canActAsClicker();
    if (endTurnBtn) {
        endTurnBtn.disabled = !clickerCanAct;
        endTurnBtn.classList.toggle('can-act', clickerCanAct);

        // Update tooltip/title based on state
        if (state.gameState.gameOver) {
            endTurnBtn.title = t('roles.gameIsOver');
        } else if (clickerCanAct) {
            endTurnBtn.title = t('roles.endTurnTitle');
        } else if (state.playerTeam === state.gameState.currentTurn) {
            endTurnBtn.title = t('roles.onlyClickerCanEndTurn');
        } else {
            endTurnBtn.title = t('roles.waitForYourTurn');
        }
    }

    // Team selection (scoreboard buttons)
    const isRedTeam = state.playerTeam === 'red';
    const isBlueTeam = state.playerTeam === 'blue';
    const isUnaffiliated = !state.playerTeam;

    if (redTeamBtn) {
        redTeamBtn.classList.toggle('selected', isRedTeam);
        redTeamBtn.classList.toggle('loading', isChangingRole() && changingTarget() === 'red');
        redTeamBtn.setAttribute('aria-pressed', isRedTeam.toString());
    }
    if (blueTeamBtn) {
        blueTeamBtn.classList.toggle('selected', isBlueTeam);
        blueTeamBtn.classList.toggle('loading', isChangingRole() && changingTarget() === 'blue');
        blueTeamBtn.setAttribute('aria-pressed', isBlueTeam.toString());
    }

    // Role buttons - styled based on selected team
    const isSpy = isSpymaster();
    const isClickerRole = isClickerSelector();

    if (spymasterBtn) {
        // Enable only if on a team and not currently changing role
        spymasterBtn.disabled = !state.playerTeam || isChangingRole();
        spymasterBtn.classList.toggle('active', isSpy);
        spymasterBtn.classList.toggle(
            'loading',
            isChangingRole() && (changingTarget() === 'spymaster' || pendingRole() === 'spymaster')
        );
        spymasterBtn.classList.remove('red-team', 'blue-team');
        if (state.playerTeam) {
            spymasterBtn.classList.add(state.playerTeam + '-team');
        }
        spymasterBtn.setAttribute('aria-pressed', isSpy.toString());
    }
    if (clickerBtn) {
        // Enable only if on a team and not currently changing role
        clickerBtn.disabled = !state.playerTeam || isChangingRole();
        clickerBtn.classList.toggle('active', isClickerRole);
        clickerBtn.classList.toggle(
            'loading',
            isChangingRole() && (changingTarget() === 'clicker' || pendingRole() === 'clicker')
        );
        clickerBtn.classList.remove('red-team', 'blue-team');
        if (state.playerTeam) {
            clickerBtn.classList.add(state.playerTeam + '-team');
        }
        clickerBtn.setAttribute('aria-pressed', isClickerRole.toString());
    }

    // Update role hint - only show when helpful (hide when role is in banner)
    if (roleHint) {
        if (!state.playerTeam) {
            roleHint.textContent = t('roles.selectTeamFirst');
            roleHint.classList.remove('hidden');
        } else if (isSpy || isClickerRole) {
            // Role already displayed in banner - hide redundant hint
            roleHint.classList.add('hidden');
        } else {
            if (isClickerFallback()) {
                roleHint.textContent = t('roles.clickerOfflineCanClick');
                roleHint.classList.remove('hidden');
            } else {
                roleHint.textContent = t('roles.chooseRole');
                roleHint.classList.remove('hidden');
            }
        }
    }
}

export function setTeam(team: string | null): void {
    // In multiplayer mode, send to server and let server response update state
    if (state.isMultiplayerMode && isClientConnected()) {
        // ISSUE FIX: Must be in a room before setting team
        if (!EigennamenClient.isInRoom()) {
            logger.warn('setTeam: Not in a room yet, ignoring');
            showToast(t('multiplayer.waitJoiningRoom'), 'info');
            return;
        }
        // Prevent double-click while request in progress
        if (isChangingRole()) {
            logger.debug('setTeam: blocked - role change in progress');
            return;
        }
        logger.debug('setTeam: setting team to', team);

        const operationId = generateOperationId();
        const target = team || 'spectate';
        startAbsoluteTimeout();

        // Optimistic UI update — apply team change immediately
        const prevTeam = state.playerTeam;
        const prevSpymaster = state.spymasterTeam;
        const prevClicker = state.clickerTeam;
        if (state.playerTeam !== team) {
            state.spymasterTeam = null;
            state.clickerTeam = null;
        }
        state.playerTeam = team;

        state.roleChange = {
            phase: 'changing_team',
            target,
            operationId,
            revertFn: () => {
                state.playerTeam = prevTeam;
                state.spymasterTeam = prevSpymaster;
                state.clickerTeam = prevClicker;
                refreshRoleUI();
            },
        };
        refreshRoleUI();

        EigennamenClient.setTeam(team, (ack: AckResult) => {
            if (ack && ack.error && state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                logger.warn('setTeam: server ack error, reverting optimistic update');
                revertAndClearRoleChange();
                showToast(getErrorMessage(ack.error), 'error');
            }
        });

        // The absolute timeout (ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS) handles lost-ack recovery.
        // No per-operation timeout needed — a single mechanism prevents state-machine stalls.
        return;
    }

    // Standalone mode: update local state directly
    // When changing teams, clear any team-specific roles
    const hadRole = state.spymasterTeam || state.clickerTeam;
    const oldRole = state.spymasterTeam ? t('roles.spymaster') : state.clickerTeam ? t('roles.clicker') : null;

    if (state.playerTeam !== team) {
        if (state.spymasterTeam) state.spymasterTeam = null;
        if (state.clickerTeam) state.clickerTeam = null;
    }
    state.playerTeam = team;
    refreshRoleUI();

    // Announce role change to screen reader if role was cleared
    if (hadRole && oldRole) {
        // Use nullish coalescing for safe team name access
        const teamName =
            (team && state.teamNames[team as keyof typeof state.teamNames]) ||
            (team === 'red' ? 'Red' : team === 'blue' ? 'Blue' : t('roles.spectator'));
        announceToScreenReader(t('game.roleCleared', { role: oldRole, team: teamName }));
    }
}

// ---- Shared role setter (eliminates duplication between setSpymaster/setClicker) ----

function refreshRoleUI(): void {
    updateRoleBanner();
    updateControls();
    renderBoard();
}

/**
 * Core implementation shared by setSpymaster and setClicker.
 *
 * @param team         Target team ('red' | 'blue')
 * @param roleName     'spymaster' | 'clicker'
 * @param getOwnState  Getter for this role's state
 * @param setOwnState  Setter for this role's state
 * @param clearOther   Clears the other role's state (mutual exclusion)
 */
function setRoleForTeam(
    team: string,
    roleName: 'spymaster' | 'clicker',
    getOwnState: () => string | null,
    setOwnState: (v: string | null) => void,
    clearOther: () => void
): void {
    // --- Multiplayer path ---
    if (state.isMultiplayerMode && isClientConnected()) {
        if (!EigennamenClient.isInRoom()) {
            logger.warn(`set${roleName}: Not in a room yet, ignoring`);
            showToast(t('multiplayer.waitJoiningRoom'), 'info');
            return;
        }
        if (isChangingRole()) {
            logger.debug(`set${roleName}: blocked - role change in progress`);
            return;
        }
        logger.debug(`set${roleName}: setting ${roleName} for team`, team, 'current playerTeam:', state.playerTeam);

        const operationId = generateOperationId();
        startAbsoluteTimeout();
        const prevTeam = state.playerTeam;
        const prevSpymaster = state.spymasterTeam;
        const prevClicker = state.clickerTeam;
        const revertOptimistic = () => {
            state.playerTeam = prevTeam;
            state.spymasterTeam = prevSpymaster;
            state.clickerTeam = prevClicker;
            refreshRoleUI();
        };

        // Optimistic UI update
        if (getOwnState() === team) {
            setOwnState(null);
        } else {
            state.playerTeam = team;
            setOwnState(team);
            clearOther();
        }

        const ackHandler = (ack: AckResult) => {
            if (ack && ack.error && state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                logger.warn(`set${roleName}: server ack error, reverting optimistic update`);
                revertAndClearRoleChange();
                showToast(getErrorMessage(ack.error), 'error');
            }
        };

        const prevOwn = roleName === 'spymaster' ? prevSpymaster : prevClicker;
        if (prevOwn === team) {
            // Toggle off
            state.roleChange = { phase: 'changing_role', target: roleName, operationId, revertFn: revertOptimistic };
            EigennamenClient.setRole('spectator', ackHandler);
        } else if (prevTeam !== team) {
            // Need team change first, then role
            state.roleChange = {
                phase: 'team_then_role',
                target: roleName,
                operationId,
                revertFn: revertOptimistic,
                pendingRole: roleName,
            };
            EigennamenClient.setTeam(team, ackHandler);
        } else {
            // Already on correct team, just change role
            state.roleChange = { phase: 'changing_role', target: roleName, operationId, revertFn: revertOptimistic };
            EigennamenClient.setRole(roleName, ackHandler);
        }
        refreshRoleUI();

        // The absolute timeout (ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS) handles lost-ack recovery
        // for all phases including compound team_then_role operations.
        // No per-operation timeout needed — a single mechanism prevents state-machine stalls.
        return;
    }

    // --- Standalone path ---
    if (getOwnState() === team) {
        setOwnState(null);
    } else {
        setOwnState(team);
        state.playerTeam = team;
        clearOther();
    }
    refreshRoleUI();
}

export function setSpymaster(team: string): void {
    setRoleForTeam(
        team,
        'spymaster',
        () => state.spymasterTeam,
        (v) => {
            state.spymasterTeam = v;
        },
        () => {
            state.clickerTeam = null;
        }
    );
}

export function setClicker(team: string): void {
    setRoleForTeam(
        team,
        'clicker',
        () => state.clickerTeam,
        (v) => {
            state.clickerTeam = v;
        },
        () => {
            state.spymasterTeam = null;
        }
    );
}

// Set spymaster for current team (used by unified role button)
export function setSpymasterCurrent(): void {
    if (!state.playerTeam) {
        showToast(t('roles.joinTeamFirst'), 'warning');
        return;
    }
    setSpymaster(state.playerTeam);
}

// Set clicker for current team (used by unified role button)
export function setClickerCurrent(): void {
    if (!state.playerTeam) {
        showToast(t('roles.joinTeamFirst'), 'warning');
        return;
    }
    setClicker(state.playerTeam);
}
