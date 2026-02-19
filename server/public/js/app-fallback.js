// App fallback and service worker registration
// Extracted from inline scripts in index.html for CSP compliance

window.__appModuleLoaded = false;
setTimeout(function() {
    if (!window.__appModuleLoaded) {
        var board = document.getElementById('board');
        var loading = document.getElementById('board-loading');
        if (board && (!board.querySelector('.card'))) {
            var msg = loading || document.createElement('div');
            msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:#ff6b6b;font-size:1rem;';
            msg.innerHTML = '<p><strong>Game failed to load.</strong></p>' +
                '<p style="color:#a0a0b0;margin-top:8px;">This usually means JavaScript modules could not be loaded.<br>' +
                'Make sure you are accessing the game through the server (not opening the HTML file directly).</p>' +
                '<p style="margin-top:12px;"><button id="reload-btn" style="padding:8px 20px;cursor:pointer;border-radius:6px;border:1px solid #555;background:#2a2a3e;color:#e0e0e0;">Reload Page</button></p>';
            if (!loading) board.appendChild(msg);
            // Use addEventListener instead of inline onclick for CSP compliance
            var reloadBtn = document.getElementById('reload-btn');
            if (reloadBtn) {
                reloadBtn.addEventListener('click', function() { location.reload(); });
            }
        }
    }
}, 3000);

// Register service worker for offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
        navigator.serviceWorker.register('/sw.js')
            .then(function(reg) { console.log('SW registered:', reg.scope); })
            .catch(function(err) { console.warn('SW registration failed:', err); });
    });
}
