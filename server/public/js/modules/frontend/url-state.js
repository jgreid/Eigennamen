// ========== URL STATE MODULE ==========
// URL encoding/decoding, QR code generation, and link sharing.
// Extracted from game.ts to separate URL/sharing concerns from game logic.
import { state, BOARD_SIZE, COPY_BUTTON_TEXT } from './state.js';
import { encodeWordsForURL, copyToClipboard } from './utils.js';
import { showToast } from './ui.js';
import { logger } from './logger.js';
import { t } from './i18n.js';
/**
 * Update the browser URL with current game state.
 * Called after any state change (reveal, new game, end turn).
 */
export function updateURL() {
    const revealed = state.gameState.revealed.map(r => r ? '1' : '0').join('');
    const turn = state.gameState.currentTurn === 'blue' ? 'b' : 'r';
    let url = `${window.location.origin}${window.location.pathname}?game=${state.gameState.seed}&r=${revealed}&t=${turn}`;
    // Include custom words in URL if using them
    if (state.gameState.customWords && state.gameState.words.length === BOARD_SIZE) {
        url += `&w=${encodeWordsForURL(state.gameState.words)}`;
    }
    // Only include team names if they're not defaults
    if (state.teamNames.red !== 'Red') {
        url += `&rn=${encodeURIComponent(state.teamNames.red)}`;
    }
    if (state.teamNames.blue !== 'Blue') {
        url += `&bn=${encodeURIComponent(state.teamNames.blue)}`;
    }
    window.history.replaceState({}, '', url);
    const shareLink = state.cachedElements.shareLink || document.getElementById('share-link');
    if (shareLink)
        shareLink.value = url;
    // Update QR code for easy sharing
    updateQRCode(url);
}
/**
 * Update QR code with current game URL.
 * Uses qrcode-generator library (CDN) for reliable QR code generation.
 */
export function updateQRCode(url) {
    const canvas = document.getElementById('qr-canvas');
    const shareCanvas = document.getElementById('share-qr-canvas');
    const qrSection = document.getElementById('qr-section');
    const shareLinkInput = document.getElementById('share-link-input');
    const targetUrl = url || window.location.href;
    // Update share link input
    if (shareLinkInput) {
        shareLinkInput.value = targetUrl;
    }
    // Check if qrcode-generator library is loaded
    if (typeof qrcode !== 'function') {
        logger.debug('QR code library not loaded, hiding QR section');
        if (qrSection)
            qrSection.style.display = 'none';
        return;
    }
    try {
        // Create QR code with auto type number (0) and Medium error correction
        const qr = qrcode(0, 'M');
        qr.addData(targetUrl);
        qr.make();
        const moduleCount = qr.getModuleCount();
        const scale = 8;
        const margin = 2;
        const canvasSize = (moduleCount + margin * 2) * scale;
        const darkColor = '#1a1a2e';
        const lightColor = '#ffffff';
        // Helper function to draw QR to canvas
        function drawQRToCanvas(targetCanvas) {
            if (!targetCanvas)
                return;
            targetCanvas.width = canvasSize;
            targetCanvas.height = canvasSize;
            const ctx = targetCanvas.getContext('2d');
            // Fill background
            ctx.fillStyle = lightColor;
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            // Draw modules
            ctx.fillStyle = darkColor;
            for (let row = 0; row < moduleCount; row++) {
                for (let col = 0; col < moduleCount; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
                    }
                }
            }
        }
        // Update both canvases
        drawQRToCanvas(canvas);
        drawQRToCanvas(shareCanvas);
        // Show QR section on success
        if (qrSection)
            qrSection.style.display = '';
    }
    catch (e) {
        logger.error('QR code generation failed:', e);
        // Hide QR section if URL is too long or other error
        if (qrSection)
            qrSection.style.display = 'none';
    }
}
/**
 * Copy the current game link to clipboard.
 */
export async function copyLink() {
    // Get URL from either share link input
    const input = state.cachedElements.shareLink || document.getElementById('share-link-input');
    const btn = document.querySelector('.btn-copy');
    const linkPanelBtn = document.querySelector('.btn-copy-link');
    const feedback = document.getElementById('copy-feedback');
    if (!input)
        return;
    // Clear any existing timeout to prevent flickering
    if (state.copyButtonTimeoutId) {
        clearTimeout(state.copyButtonTimeoutId);
        state.copyButtonTimeoutId = null;
    }
    const urlToCopy = input.value || window.location.href;
    const copied = await copyToClipboard(urlToCopy);
    if (copied) {
        showToast(t('toast.linkCopied'), 'success', 3000);
    }
    else {
        showToast(t('toast.failedToCopy'), 'warning', 3000);
    }
    // Update feedback for both buttons
    if (btn) {
        btn.textContent = t('game.copiedShort');
    }
    if (linkPanelBtn) {
        linkPanelBtn.querySelector('.copy-text').textContent = t('game.copiedShort');
    }
    if (feedback) {
        feedback.textContent = t('toast.linkCopied');
    }
    state.copyButtonTimeoutId = setTimeout(() => {
        if (btn)
            btn.textContent = COPY_BUTTON_TEXT;
        if (linkPanelBtn)
            linkPanelBtn.querySelector('.copy-text').textContent = t('game.copy');
        if (feedback)
            feedback.textContent = '';
        state.copyButtonTimeoutId = null;
    }, 3000);
}
//# sourceMappingURL=url-state.js.map