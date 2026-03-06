// Admin Dashboard JavaScript
// Extracted from inline script in admin.html for CSP compliance

// Auto-refresh interval (10 seconds)
const REFRESH_INTERVAL = 10000;

// Health alert thresholds
const ALERT_THRESHOLDS = {
    memory: { warning: 400, critical: 480 },  // MB
    connections: { warning: 800, critical: 950 }
};

// Metrics history for chart
const METRICS_HISTORY_SIZE = 30;
const metricsHistory = {
    memory: [],
    connections: []
};

// HTML escape function to prevent XSS when rendering room data
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Validate room code format (alphanumeric only)
function isValidRoomCode(code) {
    return typeof code === 'string' && /^[A-Z0-9]{4,8}$/i.test(code);
}

// Check if value exceeds threshold
function getAlertLevel(value, thresholds) {
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.warning) return 'warning';
    return null;
}

// Create alert badge HTML
function createAlertBadge(level) {
    if (!level) return '';
    const icon = level === 'critical' ? '\u26A0' : '!';
    return `<span class="alert-badge ${level}">${icon} ${level}</span>`;
}

// Update metrics history and chart
function updateMetricsChart(memory, connections) {
    // Add to history
    metricsHistory.memory.push(memory);
    metricsHistory.connections.push(connections);

    // Trim to max size
    if (metricsHistory.memory.length > METRICS_HISTORY_SIZE) {
        metricsHistory.memory.shift();
        metricsHistory.connections.shift();
    }

    // Calculate max values for scaling
    const maxMemory = Math.max(...metricsHistory.memory, ALERT_THRESHOLDS.memory.warning);
    const maxConnections = Math.max(...metricsHistory.connections, 10);

    // Render chart
    const chartEl = document.getElementById('metrics-chart');
    if (!chartEl) return;

    chartEl.innerHTML = metricsHistory.memory.map((mem, i) => {
        const conn = parseInt(metricsHistory.connections[i], 10) || 0;
        const memHeight = Math.max(2, (mem / maxMemory) * 100);
        const connHeight = Math.max(2, (conn / Math.max(maxConnections, 1)) * 100);

        return `
            <div style="flex: 1; display: flex; gap: 1px; align-items: flex-end;">
                <div class="metrics-bar memory" style="height: ${memHeight}%;" title="Memory: ${mem}MB"></div>
                <div class="metrics-bar connections" style="height: ${connHeight}%;" title="Connections: ${conn}"></div>
            </div>
        `;
    }).join('');
}

// Show toast notification
function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Update stats display
async function fetchStats() {
    try {
        const response = await fetch('/admin/api/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');

        const data = await response.json();

        // Update status badge
        const statusBadge = document.getElementById('server-status');
        const isHealthy = data.health.redis.healthy;
        statusBadge.className = `status-badge ${isHealthy ? 'healthy' : 'unhealthy'}`;
        statusBadge.innerHTML = `
            <span class="status-dot ${isHealthy ? 'healthy' : 'unhealthy'}"></span>
            <span>${isHealthy ? 'Healthy' : 'Unhealthy'}</span>
        `;

        // Update stats with alert badges
        const memoryUsed = data.memory.heapUsed;
        const connections = data.connections.sockets;

        document.getElementById('active-rooms').textContent = data.connections.activeRooms;

        // Add alert badges for connections
        const connAlert = getAlertLevel(connections, ALERT_THRESHOLDS.connections);
        document.getElementById('connected-players').innerHTML =
            `${connections} ${createAlertBadge(connAlert)}`;

        // Add alert badges for memory
        const memAlert = getAlertLevel(memoryUsed, ALERT_THRESHOLDS.memory);
        document.getElementById('memory-usage').innerHTML =
            `${memoryUsed} ${createAlertBadge(memAlert)}`;

        document.getElementById('uptime').textContent = data.uptime.formatted;

        // Update metrics chart
        updateMetricsChart(memoryUsed, connections);

        // Update health indicators
        const redisHealth = document.getElementById('redis-health');
        redisHealth.className = `health-indicator ${data.health.redis.healthy ? 'ok' : 'error'}`;
        document.getElementById('redis-mode').textContent = data.health.redis.mode === 'memory' ? 'In-Memory Mode' : 'Redis Connected';

        const dbHealth = document.getElementById('db-health');
        dbHealth.className = `health-indicator ${data.health.database.enabled ? 'ok' : 'disabled'}`;
        document.getElementById('db-status').textContent = data.health.database.enabled ? 'Connected' : 'Disabled';

        // Update rate limit stats
        if (data.rateLimits && data.rateLimits.http) {
            document.getElementById('rate-total').textContent = data.rateLimits.http.totalRequests || 0;
            document.getElementById('rate-blocked').textContent = data.rateLimits.http.blockedRequests || 0;
            document.getElementById('rate-percent').textContent = data.rateLimits.http.blockRate || '0%';
            document.getElementById('rate-ips').textContent = data.rateLimits.http.uniqueIPs || 0;
        }

        // Update last update time
        document.getElementById('last-update').textContent = new Date().toLocaleTimeString();

    } catch (error) {
        console.error('Error fetching stats:', error);
        const statusBadge = document.getElementById('server-status');
        statusBadge.className = 'status-badge unhealthy';
        statusBadge.innerHTML = `
            <span class="status-dot unhealthy"></span>
            <span>Connection Error</span>
        `;
    }
}

// Track expanded rooms
const expandedRooms = new Set();

// Fetch and display rooms
async function fetchRooms() {
    const container = document.getElementById('rooms-container');

    try {
        const response = await fetch('/admin/api/rooms');
        if (!response.ok) throw new Error('Failed to fetch rooms');

        const data = await response.json();

        if (data.rooms.length === 0) {
            container.innerHTML = '<div class="empty-state">No active rooms</div>';
            return;
        }

        // Filter to only valid rooms and escape all user-controllable data
        const validRooms = data.rooms.filter(room => isValidRoomCode(room.code));

        container.innerHTML = `
            <table>
                <thead>
                    <tr>
                        <th></th>
                        <th>Room Code</th>
                        <th>Status</th>
                        <th>Players</th>
                        <th>Timer</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${validRooms.map(room => {
                        // Sanitize all values before rendering
                        const safeCode = escapeHTML(room.code);
                        const safeStatus = ['waiting', 'playing'].includes(room.status) ? room.status : 'waiting';
                        const safePlayerCount = Number.isInteger(room.playerCount) ? room.playerCount : 0;
                        const turnTimer = room.settings?.turnTimer;
                        const safeTurnTimer = Number.isInteger(turnTimer) && turnTimer > 0 ? turnTimer + 's' : 'Off';
                        const safeCreatedAt = room.createdAt ? new Date(room.createdAt).toLocaleTimeString() : '-';
                        const isExpanded = expandedRooms.has(room.code);

                        return `
                        <tr class="room-row" data-code="${safeCode}" data-action="toggle-room">
                            <td style="width: 30px; text-align: center;">${isExpanded ? '\u25BC' : '\u25B6'}</td>
                            <td><strong>${safeCode}</strong></td>
                            <td><span class="room-status ${safeStatus}">${escapeHTML(safeStatus)}</span></td>
                            <td>${safePlayerCount}</td>
                            <td>${safeTurnTimer}</td>
                            <td>${safeCreatedAt}</td>
                            <td>
                                <button class="btn btn-danger btn-sm" data-action="close-room" data-room-code="${safeCode}">Close</button>
                            </td>
                        </tr>
                        <tr>
                            <td colspan="7" style="padding: 0; border: none;">
                                <div class="room-details ${isExpanded ? 'expanded' : ''}" id="room-details-${safeCode}">
                                    <div class="loading" id="room-loading-${safeCode}">Loading player details...</div>
                                    <div class="player-list-admin" id="player-list-${safeCode}"></div>
                                </div>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        `;

        // Re-fetch details for expanded rooms
        for (const code of expandedRooms) {
            if (validRooms.some(r => r.code === code)) {
                fetchRoomDetails(code);
            }
        }

    } catch (error) {
        console.error('Error fetching rooms:', error);
        container.innerHTML = '<div class="empty-state">Failed to load rooms</div>';
    }
}

// Toggle room details expansion
async function toggleRoomDetails(code) {
    if (!isValidRoomCode(code)) return;

    const detailsEl = document.getElementById(`room-details-${code}`);
    if (!detailsEl) return;

    if (expandedRooms.has(code)) {
        expandedRooms.delete(code);
        detailsEl.classList.remove('expanded');
    } else {
        expandedRooms.add(code);
        detailsEl.classList.add('expanded');
        await fetchRoomDetails(code);
    }

    // Update arrow indicator
    const row = document.querySelector(`tr[data-code="${code}"]`);
    if (row) {
        const arrow = row.querySelector('td:first-child');
        if (arrow) arrow.textContent = expandedRooms.has(code) ? '\u25BC' : '\u25B6';
    }
}

// Fetch detailed room info with players
async function fetchRoomDetails(code) {
    if (!isValidRoomCode(code)) return;

    const loadingEl = document.getElementById(`room-loading-${code}`);
    const playerListEl = document.getElementById(`player-list-${code}`);

    if (!playerListEl) return;

    try {
        const response = await fetch(`/admin/api/rooms/${encodeURIComponent(code)}/details`);
        if (!response.ok) throw new Error('Failed to fetch room details');

        const data = await response.json();

        if (loadingEl) loadingEl.style.display = 'none';

        if (!data.players || data.players.length === 0) {
            playerListEl.innerHTML = '<div class="empty-state">No players in room</div>';
            return;
        }

        playerListEl.innerHTML = data.players.map(player => {
            const safeName = escapeHTML(player.nickname || 'Unknown');
            const safeId = escapeHTML(player.id || '');
            const isHost = player.isHost;
            const isSpymaster = player.role === 'spymaster';
            const teamClass = player.team === 'red' ? 'team-red' : player.team === 'blue' ? 'team-blue' : 'team-none';

            return `
                <div class="player-card">
                    <div class="player-info">
                        <span class="${teamClass}">${safeName}</span>
                        ${isHost ? '<span class="player-role host">Host</span>' : ''}
                        ${isSpymaster ? '<span class="player-role spymaster">Spymaster</span>' : ''}
                    </div>
                    ${!isHost ? `<button class="btn btn-danger btn-sm" data-action="kick-player" data-room-code="${escapeHTML(code)}" data-player-id="${safeId}">Kick</button>` : ''}
                </div>
            `;
        }).join('');

    } catch (error) {
        console.error('Error fetching room details:', error);
        if (loadingEl) loadingEl.textContent = 'Failed to load players';
    }
}

// Kick a player from a room
async function kickPlayer(roomCode, playerId) {
    if (!isValidRoomCode(roomCode)) {
        showToast('Invalid room code', 'error');
        return;
    }

    if (!confirm('Are you sure you want to kick this player?')) {
        return;
    }

    try {
        const response = await fetch(`/admin/api/rooms/${encodeURIComponent(roomCode)}/players/${encodeURIComponent(playerId)}`, {
            method: 'DELETE',
            headers: {
                'X-Requested-With': 'fetch'
            }
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error?.message || 'Failed to kick player');
        }

        showToast('Player kicked successfully');
        await fetchRoomDetails(roomCode);
        fetchRooms();
        fetchStats();

    } catch (error) {
        console.error('Error kicking player:', error);
        showToast(error.message, 'error');
    }
}

// Close a room
async function closeRoom(code) {
    // Validate room code format to prevent injection
    if (!isValidRoomCode(code)) {
        showToast('Invalid room code', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to close room ${escapeHTML(code)}? All players will be disconnected.`)) {
        return;
    }

    try {
        const response = await fetch(`/admin/api/rooms/${encodeURIComponent(code)}`, {
            method: 'DELETE',
            headers: {
                'X-Requested-With': 'fetch'
            }
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error?.message || 'Failed to close room');
        }

        showToast(`Room ${escapeHTML(code)} closed successfully`);
        fetchRooms();
        fetchStats();

    } catch (error) {
        console.error('Error closing room:', error);
        showToast(error.message, 'error');
    }
}

// Handle broadcast form
document.getElementById('broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    const message = document.getElementById('broadcast-message').value.trim();
    const type = document.getElementById('broadcast-type').value;

    if (!message) return;

    try {
        const response = await fetch('/admin/api/broadcast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Requested-With': 'fetch'
            },
            body: JSON.stringify({ message, type })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error?.message || 'Failed to send broadcast');
        }

        showToast('Broadcast sent successfully');
        document.getElementById('broadcast-message').value = '';

    } catch (error) {
        console.error('Error sending broadcast:', error);
        showToast(error.message, 'error');
    }
});

// Delegated event handler for rooms container (prevents XSS via template literals)
document.getElementById('rooms-container').addEventListener('click', function(e) {
    const target = e.target;

    // Handle close-room button
    if (target.dataset && target.dataset.action === 'close-room') {
        e.stopPropagation();
        const code = target.dataset.roomCode;
        if (code && isValidRoomCode(code)) {
            closeRoom(code);
        }
        return;
    }

    // Handle kick-player button
    if (target.dataset && target.dataset.action === 'kick-player') {
        e.stopPropagation();
        const code = target.dataset.roomCode;
        const playerId = target.dataset.playerId;
        if (code && playerId && isValidRoomCode(code)) {
            kickPlayer(code, playerId);
        }
        return;
    }

    // Handle room row toggle (click on <tr> or child)
    const row = target.closest('tr[data-action="toggle-room"]');
    if (row && row.dataset.code) {
        const code = row.dataset.code;
        if (isValidRoomCode(code)) {
            toggleRoomDetails(code);
        }
    }
});

// Initial load
fetchStats();
fetchRooms();

// Auto-refresh
setInterval(() => {
    fetchStats();
    fetchRooms();
}, REFRESH_INTERVAL);
