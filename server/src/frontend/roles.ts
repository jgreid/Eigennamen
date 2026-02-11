// ========== ROLES MODULE ==========
// Team and role management

import { state, ROLE_BANNER_CONFIG } from './state.js';
import { escapeHTML } from './utils.js';
import { showToast, announceToScreenReader } from './ui.js';
import { renderBoard } from './board.js';

// ---- Role-change state machine helpers ----

function generateOperationId(): string {
    return Date.now() + '-' + Math.random().toString(36).substr(2, 9);
}

/** Transition to idle, discarding any in-flight state. */
export function clearRoleChange(): void {
    state.roleChange = { phase: 'idle' };
}

/** Revert optimistic UI then transition to idle. */
export function revertAndClearRoleChange(): void {
    if (state.roleChange.phase !== 'idle') {
        state.roleChange.revertFn();
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

    const hostBadge = state.isHost ? '<span class="host-badge">Host</span>' : '';

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
        banner.innerHTML = `<strong>${escapeHTML(state.teamNames[team] || (team === 'red' ? 'Red' : 'Blue'))}</strong> ${config.label}${hostBadge}`;
    } else if (state.isHost) {
        banner.className = 'role-banner host';
        banner.innerHTML = `<span class="host-badge">Host</span> Spectator`;
    } else {
        banner.className = 'role-banner viewer';
        banner.innerHTML = `Spectator`;
    }
}

export function updateControls(): void {
    const endTurnBtn = document.getElementById('btn-end-turn') as HTMLButtonElement | null;
    const spymasterBtn = document.getElementById('btn-spymaster') as HTMLButtonElement | null;
    const clickerBtn = document.getElementById('btn-clicker') as HTMLButtonElement | null;
    const redTeamBtn = document.getElementById('btn-team-red');
    const blueTeamBtn = document.getElementById('btn-team-blue');
    const spectateBtn = document.getElementById('btn-spectate');
    const roleHint = document.getElementById('role-hint');

    // Clicker can end turn when it's their team's turn
    const isActiveClicker = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn;
    // Also allow non-clicker team members to end turn if clicker is disconnected
    const clickerFallback: boolean = state.isMultiplayerMode && !isActiveClicker
        && state.playerTeam === state.gameState.currentTurn
        && (() => {
            const teamClicker = state.multiplayerPlayers.find(
                (p: any) => p.team === state.gameState.currentTurn && p.role === 'clicker'
            );
            return !teamClicker || !teamClicker.connected;
        })();
    const clickerCanAct = (isActiveClicker || clickerFallback) && !state.gameState.gameOver;
    if (endTurnBtn) {
        endTurnBtn.disabled = !clickerCanAct;
        endTurnBtn.classList.toggle('can-act', clickerCanAct);

        // Update tooltip/title based on state
        if (state.gameState.gameOver) {
            endTurnBtn.title = 'Game is over';
        } else if (isActiveClicker || clickerFallback) {
            endTurnBtn.title = 'End your team\'s turn';
        } else if (state.playerTeam === state.gameState.currentTurn) {
            endTurnBtn.title = 'Only the Clicker can end the turn';
        } else {
            endTurnBtn.title = 'Wait for your team\'s turn';
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
    if (spectateBtn) {
        spectateBtn.classList.toggle('active', isUnaffiliated);
        spectateBtn.classList.toggle('loading', isChangingRole() && changingTarget() === 'spectate');
        spectateBtn.setAttribute('aria-pressed', isUnaffiliated.toString());
    }

    // Role buttons - styled based on selected team
    const isSpy = !!state.spymasterTeam;
    const isClicker = !!state.clickerTeam;

    if (spymasterBtn) {
        // Enable only if on a team and not currently changing role
        spymasterBtn.disabled = !state.playerTeam || isChangingRole();
        spymasterBtn.classList.toggle('active', isSpy);
        spymasterBtn.classList.toggle('loading', isChangingRole() && (changingTarget() === 'spymaster' || pendingRole() === 'spymaster'));
        spymasterBtn.classList.remove('red-team', 'blue-team');
        if (state.playerTeam) {
            spymasterBtn.classList.add(state.playerTeam + '-team');
        }
        spymasterBtn.setAttribute('aria-pressed', isSpy.toString());
    }
    if (clickerBtn) {
        // Enable only if on a team and not currently changing role
        clickerBtn.disabled = !state.playerTeam || isChangingRole();
        clickerBtn.classList.toggle('active', isClicker);
        clickerBtn.classList.toggle('loading', isChangingRole() && (changingTarget() === 'clicker' || pendingRole() === 'clicker'));
        clickerBtn.classList.remove('red-team', 'blue-team');
        if (state.playerTeam) {
            clickerBtn.classList.add(state.playerTeam + '-team');
        }
        clickerBtn.setAttribute('aria-pressed', isClicker.toString());
    }

    // Update role hint - only show when helpful (hide when role is in banner)
    if (roleHint) {
        if (!state.playerTeam) {
            roleHint.textContent = 'Select a team above to choose a role';
            roleHint.classList.remove('hidden');
        } else if (isSpy || isClicker) {
            // Role already displayed in banner - hide redundant hint
            roleHint.classList.add('hidden');
        } else {
            // Check if player can click due to clicker disconnected
            const canClickDueToDisconnect = state.isMultiplayerMode &&
                state.playerTeam === state.gameState.currentTurn &&
                !state.gameState.gameOver &&
                (() => {
                    const teamClicker = state.multiplayerPlayers.find(
                        (p: any) => p.team === state.gameState.currentTurn && p.role === 'clicker'
                    );
                    return !teamClicker || !teamClicker.connected;
                })();

            if (canClickDueToDisconnect) {
                roleHint.textContent = 'Clicker offline - you can reveal cards';
                roleHint.classList.remove('hidden');
            } else {
                roleHint.textContent = 'Choose Spymaster or Clicker';
                roleHint.classList.remove('hidden');
            }
        }
    }
}

export function setTeam(team: string | null): void {
    // In multiplayer mode, send to server and let server response update state
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
        // ISSUE FIX: Must be in a room before setting team
        if (!CodenamesClient.isInRoom()) {
            console.warn('setTeam: Not in a room yet, ignoring');
            showToast('Please wait - joining room...', 'info');
            return;
        }
        // Prevent double-click while request in progress
        if (isChangingRole()) {
            console.log('setTeam: blocked - role change in progress');
            return;
        }
        console.log('setTeam: setting team to', team);

        const operationId = generateOperationId();
        const target = team || 'spectate';

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
                updateRoleBanner();
                updateControls();
                renderBoard();
            }
        };
        updateRoleBanner();
        updateControls();
        renderBoard();

        CodenamesClient.setTeam(team, (ack: any) => {
            if (ack && ack.error && state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                console.warn('setTeam: server ack error, reverting optimistic update');
                revertAndClearRoleChange();
            }
        });

        // Safety timeout in case ack is lost
        setTimeout(() => {
            if (state.roleChange.phase === 'changing_team' && state.roleChange.operationId === operationId) {
                console.warn('setTeam: Safety timeout - clearing role change state');
                clearRoleChange();
                updateControls();
            }
        }, 5000);
        return;
    }

    // Standalone mode: update local state directly
    // When changing teams, clear any team-specific roles
    const hadRole = state.spymasterTeam || state.clickerTeam;
    const oldRole = state.spymasterTeam ? 'Spymaster' : (state.clickerTeam ? 'Clicker' : null);

    if (state.playerTeam !== team) {
        if (state.spymasterTeam) state.spymasterTeam = null;
        if (state.clickerTeam) state.clickerTeam = null;
    }
    state.playerTeam = team;
    updateRoleBanner();
    updateControls();
    renderBoard();

    // Announce role change to screen reader if role was cleared
    if (hadRole && oldRole) {
        // Use nullish coalescing for safe team name access
        const teamName = (team && state.teamNames[team]) || (team === 'red' ? 'Red' : team === 'blue' ? 'Blue' : 'Spectator');
        announceToScreenReader(`${oldRole} role cleared. Now on ${teamName} team.`);
    }
}

export function setSpymaster(team: string): void {
    // In multiplayer mode, send to server and let server response update state
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
        // ISSUE FIX: Must be in a room before setting role
        if (!CodenamesClient.isInRoom()) {
            console.warn('setSpymaster: Not in a room yet, ignoring');
            showToast('Please wait - joining room...', 'info');
            return;
        }
        // Prevent double-click while request in progress
        if (isChangingRole()) {
            console.log('setSpymaster: blocked - role change in progress');
            return;
        }
        console.log('setSpymaster: setting spymaster for team', team, 'current playerTeam:', state.playerTeam);

        const operationId = generateOperationId();

        // Capture previous state for revert
        const prevTeam = state.playerTeam;
        const prevSpymaster = state.spymasterTeam;
        const prevClicker = state.clickerTeam;
        const revertOptimistic = () => {
            state.playerTeam = prevTeam;
            state.spymasterTeam = prevSpymaster;
            state.clickerTeam = prevClicker;
            updateRoleBanner();
            updateControls();
            renderBoard();
        };

        // Optimistic UI update
        if (state.spymasterTeam === team) {
            state.spymasterTeam = null;
        } else {
            state.playerTeam = team;
            state.spymasterTeam = team;
            state.clickerTeam = null;
        }

        const ackHandler = (ack: any) => {
            if (ack && ack.error && state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                console.warn('setSpymaster: server ack error, reverting optimistic update');
                revertAndClearRoleChange();
            }
        };

        if (prevSpymaster === team) {
            // Toggle off - become spectator (team member without role)
            state.roleChange = { phase: 'changing_role', target: 'spymaster', operationId, revertFn: revertOptimistic };
            CodenamesClient.setRole('spectator', ackHandler);
        } else if (prevTeam !== team) {
            // Need team change first, then role
            state.roleChange = { phase: 'team_then_role', target: 'spymaster', operationId, revertFn: revertOptimistic, pendingRole: 'spymaster' };
            CodenamesClient.setTeam(team, ackHandler);
        } else {
            // Already on correct team, just change role
            state.roleChange = { phase: 'changing_role', target: 'spymaster', operationId, revertFn: revertOptimistic };
            CodenamesClient.setRole('spymaster', ackHandler);
        }
        updateRoleBanner();
        updateControls();
        renderBoard();

        // Safety timeout in case ack is lost
        setTimeout(() => {
            if (state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                console.warn('setSpymaster: Safety timeout - clearing role change state');
                clearRoleChange();
                updateControls();
            }
        }, 5000);
        return;
    }

    // Standalone mode: update local state directly
    if (state.spymasterTeam === team) {
        // Toggle off - become team member
        state.spymasterTeam = null;
    } else {
        state.spymasterTeam = team;
        state.playerTeam = team; // Automatically set team affiliation
        state.clickerTeam = null; // Can't be both spymaster and clicker
    }
    updateRoleBanner();
    updateControls();
    renderBoard();
}

export function setClicker(team: string): void {
    // In multiplayer mode, send to server and let server response update state
    if (state.isMultiplayerMode && CodenamesClient && CodenamesClient.isConnected()) {
        // ISSUE FIX: Must be in a room before setting role
        if (!CodenamesClient.isInRoom()) {
            console.warn('setClicker: Not in a room yet, ignoring');
            showToast('Please wait - joining room...', 'info');
            return;
        }
        // Prevent double-click while request in progress
        if (isChangingRole()) {
            console.log('setClicker: blocked - role change in progress');
            return;
        }
        console.log('setClicker: setting clicker for team', team, 'current playerTeam:', state.playerTeam);

        const operationId = generateOperationId();

        // Capture previous state for revert
        const prevTeam = state.playerTeam;
        const prevSpymaster = state.spymasterTeam;
        const prevClicker = state.clickerTeam;
        const revertOptimistic = () => {
            state.playerTeam = prevTeam;
            state.spymasterTeam = prevSpymaster;
            state.clickerTeam = prevClicker;
            updateRoleBanner();
            updateControls();
            renderBoard();
        };

        // Optimistic UI update
        if (state.clickerTeam === team) {
            state.clickerTeam = null;
        } else {
            state.playerTeam = team;
            state.clickerTeam = team;
            state.spymasterTeam = null;
        }

        const ackHandler = (ack: any) => {
            if (ack && ack.error && state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                console.warn('setClicker: server ack error, reverting optimistic update');
                revertAndClearRoleChange();
            }
        };

        if (prevClicker === team) {
            // Toggle off - become spectator (team member without role)
            state.roleChange = { phase: 'changing_role', target: 'clicker', operationId, revertFn: revertOptimistic };
            CodenamesClient.setRole('spectator', ackHandler);
        } else if (prevTeam !== team) {
            // Need team change first, then role
            state.roleChange = { phase: 'team_then_role', target: 'clicker', operationId, revertFn: revertOptimistic, pendingRole: 'clicker' };
            CodenamesClient.setTeam(team, ackHandler);
        } else {
            // Already on correct team, just change role
            state.roleChange = { phase: 'changing_role', target: 'clicker', operationId, revertFn: revertOptimistic };
            CodenamesClient.setRole('clicker', ackHandler);
        }
        updateRoleBanner();
        updateControls();
        renderBoard();

        // Safety timeout in case ack is lost
        setTimeout(() => {
            if (state.roleChange.phase !== 'idle' && state.roleChange.operationId === operationId) {
                console.warn('setClicker: Safety timeout - clearing role change state');
                clearRoleChange();
                updateControls();
            }
        }, 5000);
        return;
    }

    // Standalone mode: update local state directly
    if (state.clickerTeam === team) {
        // Toggle off - become team member
        state.clickerTeam = null;
    } else {
        state.clickerTeam = team;
        state.playerTeam = team; // Automatically set team affiliation
        state.spymasterTeam = null; // Can't be both spymaster and clicker
    }
    updateRoleBanner();
    updateControls();
    renderBoard();
}

// Set spymaster for current team (used by unified role button)
export function setSpymasterCurrent(): void {
    if (!state.playerTeam) {
        showToast('Please join a team first by clicking on a team score', 'warning');
        return;
    }
    setSpymaster(state.playerTeam);
}

// Set clicker for current team (used by unified role button)
export function setClickerCurrent(): void {
    if (!state.playerTeam) {
        showToast('Please join a team first by clicking on a team score', 'warning');
        return;
    }
    setClicker(state.playerTeam);
}
