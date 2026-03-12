// App fallback, service worker registration, and cache-busting
// Extracted from inline scripts in index.html for CSP compliance

window.__appModuleLoaded = false;

// --- Module load failure detection ---
// If the ES module hasn't set __appModuleLoaded after 3 seconds, show an
// error with a reload button. This catches SRI mismatches, network failures,
// and stale service worker caches serving broken JS.
setTimeout(function () {
    if (window.__appModuleLoaded) return;

    // First attempt: clear all service worker caches and reload once.
    // A stale cache is the most common cause of module load failure on mobile
    // (SW serves old index.html whose SRI hash doesn't match the new JS bundle).
    var reloaded = false;
    try {
        reloaded = sessionStorage.getItem('eigennamen-cache-bust-reload') === '1';
    } catch (e) {
        // sessionStorage blocked (private browsing) — skip auto-reload
    }

    if (!reloaded && 'caches' in window) {
        try {
            sessionStorage.setItem('eigennamen-cache-bust-reload', '1');
        } catch (e) {
            // ignore
        }
        caches.keys().then(function (names) {
            return Promise.all(names.map(function (n) { return caches.delete(n); }));
        }).then(function () {
            // Also unregister the service worker so it re-fetches everything
            if ('serviceWorker' in navigator) {
                return navigator.serviceWorker.getRegistrations().then(function (regs) {
                    return Promise.all(regs.map(function (r) { return r.unregister(); }));
                });
            }
        }).then(function () {
            location.reload();
        }).catch(function () {
            location.reload();
        });
        return;
    }

    // Clear the reload flag for next time
    try {
        sessionStorage.removeItem('eigennamen-cache-bust-reload');
    } catch (e) {
        // ignore
    }

    // Second attempt failed — show error UI
    var board = document.getElementById('board');
    var loading = document.getElementById('board-loading');
    if (board && !board.querySelector('.card')) {
        var msg = loading || document.createElement('div');
        msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:#ff6b6b;font-size:1rem;';
        msg.innerHTML = '<p><strong>Game failed to load.</strong></p>' +
            '<p style="color:#a0a0b0;margin-top:8px;">This usually means JavaScript modules could not be loaded.<br>' +
            'Try clearing your browser cache or opening in a private/incognito window.</p>' +
            '<p style="margin-top:12px;">' +
            '<button id="reload-btn" style="padding:8px 20px;cursor:pointer;border-radius:6px;border:1px solid #555;background:#2a2a3e;color:#e0e0e0;">Reload Page</button>' +
            '</p>';
        if (!loading) board.appendChild(msg);
        var reloadBtn = document.getElementById('reload-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', function () { location.reload(); });
        }
    }
}, 3000);

// --- Service worker registration with update detection ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/service-worker.js')
            .then(function (reg) {
                console.log('SW registered:', reg.scope);

                // When a new service worker is found and activated, reload the
                // page so the user gets fresh assets. Without this, the old SW
                // stays active until the user manually closes all tabs.
                reg.addEventListener('updatefound', function () {
                    var newWorker = reg.installing;
                    if (!newWorker) return;
                    newWorker.addEventListener('statechange', function () {
                        if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
                            // A new SW took over — reload to use fresh cached assets.
                            // Only reload if the page is visible to avoid disrupting
                            // background tabs.
                            if (!document.hidden) {
                                location.reload();
                            } else {
                                // Reload when the tab becomes visible again
                                document.addEventListener('visibilitychange', function onVisible() {
                                    if (!document.hidden) {
                                        document.removeEventListener('visibilitychange', onVisible);
                                        location.reload();
                                    }
                                });
                            }
                        }
                    });
                });
            })
            .catch(function (err) { console.warn('SW registration failed:', err); });
    });
}
