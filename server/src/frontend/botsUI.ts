/**
 * Host-only bot management UI: an "Add a bot" panel (team / seat / style / skill)
 * and remove-bot handling. Wraps the bot:add / bot:remove client methods. The
 * UI "style" is mapped to the best strategy for the chosen seat so the default
 * bots are smart, while still allowing weaker styles for variety.
 */
import { t } from './i18n.js';
import { showToast } from './ui.js';
import { isClientConnected, getClient } from './clientAccessor.js';

/** Map a seat + UI style to a concrete strategyId. */
export function strategyFor(seat: string, style: string): string {
    if (seat === 'spymaster') {
        return style === 'random' ? 'randomSpymaster' : 'embeddingSpymaster';
    }
    if (style === 'cautious') return 'cautiousClicker';
    if (style === 'random') return 'randomClicker';
    return 'greedyClicker';
}

function selectValue(id: string, fallback: string): string {
    const el = document.getElementById(id) as HTMLSelectElement | null;
    return el?.value || fallback;
}

/** Read the add-bot form and emit bot:add (host only). */
export function addBotFromForm(): void {
    if (!isClientConnected()) return;
    if (EigennamenClient.player?.isHost !== true) {
        showToast(t('bots.hostOnly'), 'warning');
        return;
    }
    const team = selectValue('bot-team-select', 'red');
    const seat = selectValue('bot-seat-select', 'clicker');
    const style = selectValue('bot-style-select', 'smart');
    const skill = selectValue('bot-skill-select', 'intermediate');

    EigennamenClient.addBot(team, seat, strategyFor(seat, style), skill);
    showToast(t('bots.added'), 'success', 2000);
}

/** Remove a bot by session id (host only). */
export function removeBot(playerId: string): void {
    if (!playerId || !isClientConnected()) return;
    EigennamenClient.removeBot(playerId);
}

/** Show the bot panel only to the room host. */
export function updateBotPanelVisibility(): void {
    const panel = document.getElementById('bots-panel');
    // Use the safe accessor rather than the bare EigennamenClient global: this
    // runs at startup via initBotsUI(), before any connection, and the global is
    // absent entirely if socket-client.js failed to load (e.g. SRI mismatch from
    // a stale service-worker cache). A bare reference would throw a ReferenceError
    // that aborts init() and breaks even offline mode.
    if (panel) panel.hidden = getClient()?.player?.isHost !== true;
}

export function initBotsUI(): void {
    updateBotPanelVisibility();
}
