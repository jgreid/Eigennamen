// @ts-check
const { test, expect } = require('@playwright/test');
const { io } = require('socket.io-client');

/**
 * Spectator Approval E2E Test (docs/HARDENING_PLAN.md P1-13)
 *
 * A spectator requests to join a team; the host approves one request and
 * denies another — against a real server + real sockets (this only ever
 * ran against a fully mocked Redis before).
 *
 * SCOPE NOTE (F6): the flow is now fully wired on the client too — a spectator
 * "request to join" panel emits spectator:requestJoin, a host approval modal
 * emits spectator:approveJoin, and listeners react to joinRequest/joinApproved/
 * joinDenied (frontend/spectatorJoin.ts, unit-tested in
 * __tests__/frontend/spectatorJoin.test.ts). This spec stays at the Socket.IO
 * protocol level because it also asserts the SERVER SEATING behavior end-to-end
 * (real Redis, real room/player state): on approval the server now actually
 * seats the requester onto the requested team as a clicker, not just notifies
 * them. A full two-browser Playwright rewrite driving the DOM is a reasonable
 * follow-up but adds cross-context flake for coverage the unit + protocol tests
 * already provide.
 */

const SERVER_URL = 'http://localhost:3000';

/** Connect a socket.io client and resolve once it's connected. */
function connectClient() {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, { transports: ['websocket'], reconnection: false });
        socket.once('connect', () => resolve(socket));
        socket.once('connect_error', reject);
    });
}

/** Wait for a single occurrence of a socket event, with a timeout. */
function waitForEvent(socket, event, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
        socket.once(event, (data) => {
            clearTimeout(timer);
            resolve(data);
        });
    });
}

function freshRoomId() {
    return `spec${Date.now()}`.slice(0, 20);
}

test.describe('Spectator Approval (real sockets, protocol-level; UI unit-tested separately)', () => {
    test('host approves one spectator join request and denies another', async () => {
        const roomId = freshRoomId();

        const host = await connectClient();
        const spectator1 = await connectClient();
        const spectator2 = await connectClient();

        try {
            // Host creates the room.
            const roomCreated = waitForEvent(host, 'room:created');
            host.emit('room:create', { roomId, settings: { nickname: 'RoomHost' } });
            await roomCreated;

            // Two spectators join (join with no team => role: 'spectator').
            const joined1 = waitForEvent(spectator1, 'room:joined');
            spectator1.emit('room:join', { roomId, nickname: 'Spectator1' });
            const spectator1Player = (await joined1).you;
            expect(spectator1Player.role).toBe('spectator');

            const joined2 = waitForEvent(spectator2, 'room:joined');
            spectator2.emit('room:join', { roomId, nickname: 'Spectator2' });
            const spectator2Player = (await joined2).you;
            expect(spectator2Player.role).toBe('spectator');

            // Spectator 1 requests to join red; host is notified.
            const joinRequest1 = waitForEvent(host, 'spectator:joinRequest');
            spectator1.emit('spectator:requestJoin', { team: 'red' });
            const request1 = await joinRequest1;
            expect(request1).toMatchObject({ requesterId: spectator1Player.playerId, team: 'red' });

            // Host approves spectator 1 — the server actually SEATS them onto red
            // as a clicker (not just a notification). Watch for both the approval
            // and the player:updated the seating broadcasts to the room.
            const approved1 = waitForEvent(spectator1, 'spectator:joinApproved');
            const seated1 = new Promise((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error('Timed out waiting for seating player:updated')),
                    10000
                );
                spectator1.on('player:updated', (data) => {
                    if (
                        data &&
                        data.playerId === spectator1Player.playerId &&
                        data.changes &&
                        data.changes.role === 'clicker'
                    ) {
                        clearTimeout(timer);
                        resolve(data);
                    }
                });
            });
            host.emit('spectator:approveJoin', {
                requesterId: spectator1Player.playerId,
                approved: true,
                team: 'red',
            });
            await expect(approved1).resolves.toMatchObject({ team: 'red', message: expect.any(String) });
            await expect(seated1).resolves.toMatchObject({
                playerId: spectator1Player.playerId,
                changes: expect.objectContaining({ team: 'red', role: 'clicker' }),
            });

            // Spectator 2 requests to join blue; host is notified again.
            const joinRequest2 = waitForEvent(host, 'spectator:joinRequest');
            spectator2.emit('spectator:requestJoin', { team: 'blue' });
            const request2 = await joinRequest2;
            expect(request2).toMatchObject({ requesterId: spectator2Player.playerId, team: 'blue' });

            // Host denies spectator 2 (team is ignored on a denial).
            const denied2 = waitForEvent(spectator2, 'spectator:joinDenied');
            host.emit('spectator:approveJoin', {
                requesterId: spectator2Player.playerId,
                approved: false,
                team: 'blue',
            });
            await expect(denied2).resolves.toMatchObject({ message: expect.any(String) });

            // Spectator 1 must never have received a denial, and spectator 2
            // must never have received an approval (each notified only once,
            // and only with their own request's outcome). waitForEvent's own
            // timeout rejects on a clean "nothing arrived" outcome here, which
            // is the success case for this assertion — catch it into `false`
            // rather than racing it against a second timer (a promise that
            // rejects still "wins" a Promise.race against one that resolves
            // later, so the naive race variant of this check always failed).
            const spuriousApprovalFor2 = await waitForEvent(spectator2, 'spectator:joinApproved', 1000)
                .then(() => true)
                .catch(() => false);
            expect(spuriousApprovalFor2).toBe(false);
        } finally {
            host.disconnect();
            spectator1.disconnect();
            spectator2.disconnect();
        }
    });

    test('a non-host cannot approve a spectator join request', async () => {
        const roomId = freshRoomId();

        const host = await connectClient();
        const nonHost = await connectClient();
        const spectator = await connectClient();

        try {
            const roomCreated = waitForEvent(host, 'room:created');
            host.emit('room:create', { roomId, settings: { nickname: 'RoomHost' } });
            await roomCreated;

            const nonHostJoined = waitForEvent(nonHost, 'room:joined');
            nonHost.emit('room:join', { roomId, nickname: 'NonHost' });
            await nonHostJoined;

            const spectatorJoined = waitForEvent(spectator, 'room:joined');
            spectator.emit('room:join', { roomId, nickname: 'Spectator' });
            const spectatorPlayer = (await spectatorJoined).you;

            spectator.emit('spectator:requestJoin', { team: 'red' });

            // Errors for an event route to `${domain}:error` (rateLimitHandler
            // convention) — spectator:approveJoin's failures land on spectator:error.
            const nonHostError = waitForEvent(nonHost, 'spectator:error');
            nonHost.emit('spectator:approveJoin', { requesterId: spectatorPlayer.playerId, approved: true });
            const error = await nonHostError;
            expect(error.code).toBe('NOT_HOST');
        } finally {
            host.disconnect();
            nonHost.disconnect();
            spectator.disconnect();
        }
    });
});
