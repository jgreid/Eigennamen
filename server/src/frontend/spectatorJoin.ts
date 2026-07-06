// Spectator join-request flow (F6).
//
// A spectator can ask the host to seat them on a team; the host approves or
// denies from a small prompt. On approval the server seats the requester as a
// clicker and pushes a player:updated + spectator:joinApproved; the requester
// resyncs so its board, role banner, and socket-room membership update.

import { showToast, openModal, closeModal, announceToScreenReader } from './ui.js';
import { t } from './i18n.js';
import { state } from './state.js';
import { getClient, isClientConnected } from './clientAccessor.js';
import type {
    SpectatorJoinRequestData,
    SpectatorJoinApprovedData,
    SpectatorJoinDeniedData,
} from './multiplayerTypes.js';

// Host-side queue of pending join requests (one prompt shown at a time).
const pendingRequests: SpectatorJoinRequestData[] = [];
let currentRequest: SpectatorJoinRequestData | null = null;

function teamLabel(team: 'red' | 'blue'): string {
    return team === 'red' ? state.teamNames.red : state.teamNames.blue;
}

function localIsSpectator(): boolean {
    const player = getClient()?.player;
    return !!player && (!player.team || player.role === 'spectator');
}

/** Spectator: request to join a team (Red/Blue). */
export function requestJoinTeam(team: 'red' | 'blue'): void {
    if (!state.isMultiplayerMode || !isClientConnected()) return;
    if (!localIsSpectator()) return;
    EigennamenClient.requestJoinTeam(team);
    showToast(t('spectator.requestSent', { team: teamLabel(team) }), 'info');
}

/** Host: a spectator asked to join. Queue it and surface the approval prompt. */
function onJoinRequest(data: SpectatorJoinRequestData): void {
    if (!getClient()?.player?.isHost) return;
    if (!data || !data.requesterId || (data.team !== 'red' && data.team !== 'blue')) return;

    // Collapse repeat requests from the same spectator to their latest team.
    const existing = pendingRequests.findIndex((r) => r.requesterId === data.requesterId);
    if (existing >= 0) pendingRequests.splice(existing, 1);
    pendingRequests.push(data);

    if (!currentRequest) showNextRequest();
}

function showNextRequest(): void {
    currentRequest = pendingRequests.shift() ?? null;
    if (!currentRequest) {
        closeModal('spectator-join-modal');
        return;
    }

    const textEl = document.getElementById('spectator-join-request-text');
    const message = t('spectator.wantsToJoin', {
        nickname: currentRequest.requesterNickname || t('multiplayer.aPlayer'),
        team: teamLabel(currentRequest.team),
    });
    if (textEl) textEl.textContent = message;

    openModal('spectator-join-modal');
    announceToScreenReader(message);
}

/** Host: approve the currently-shown request, then advance the queue. */
export function approvePendingJoin(): void {
    if (!currentRequest) return;
    EigennamenClient.respondToJoinRequest(currentRequest.requesterId, true, currentRequest.team);
    showNextRequest();
}

/** Host: deny the currently-shown request, then advance the queue. */
export function denyPendingJoin(): void {
    if (!currentRequest) return;
    EigennamenClient.respondToJoinRequest(currentRequest.requesterId, false, currentRequest.team);
    showNextRequest();
}

/** Requester: approved. Toast + resync so board/role/socket-rooms update. */
function onJoinApproved(data: SpectatorJoinApprovedData): void {
    const team = data?.team === 'blue' ? 'blue' : 'red';
    const msg = t('spectator.approved', { team: teamLabel(team) });
    showToast(msg, 'success');
    announceToScreenReader(msg);
    // Server has already seated us; resync pulls the fresh clicker view and
    // moves our socket out of the spectators room.
    getClient()
        ?.requestResync?.()
        .catch(() => {
            /* resync is best-effort; player:updated already moved us on the team */
        });
}

/** Requester: denied. Toast only. */
function onJoinDenied(_data: SpectatorJoinDeniedData): void {
    const msg = t('spectator.denied');
    showToast(msg, 'warning');
    announceToScreenReader(msg);
}

/**
 * Show/hide the spectator "request to join a team" panel. Shown only to a
 * spectator (non-host) in a multiplayer room while a game is in progress —
 * pre-game, spectators pick a team directly from the scoreboard.
 */
export function updateSpectatorJoinUI(): void {
    const panel = document.getElementById('spectator-join-panel');
    if (!panel) return;

    const gameActive = (state.gameState.words?.length ?? 0) > 0 && !state.gameState.gameOver;
    const show = state.isMultiplayerMode && localIsSpectator() && !getClient()?.player?.isHost && gameActive;
    panel.hidden = !show;
}

export function registerSpectatorJoinHandlers(): void {
    EigennamenClient.on('spectatorJoinRequest', onJoinRequest);
    EigennamenClient.on('spectatorJoinApproved', onJoinApproved);
    EigennamenClient.on('spectatorJoinDenied', onJoinDenied);
}
