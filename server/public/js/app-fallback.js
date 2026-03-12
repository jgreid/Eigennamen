// App fallback, service worker registration, and cache-busting
// Extracted from inline scripts in index.html for CSP compliance

window.__appModuleLoaded = false;
window.__appEventListenersReady = false;

// --- Fallback event delegation ---
// In iOS standalone/PWA mode (apple-mobile-web-app-capable), the ES module
// script can fail to load or execute.  This non-module script always runs,
// so we attach basic click handling for the setup screen here.  Once the
// module's own event listeners are registered it sets __appEventListenersReady
// and this handler defers to them.
document.addEventListener('click', function (e) {
    // Once the module's handlers are active, let them handle everything
    if (window.__appEventListenersReady) return;

    var target = e.target;
    // Walk up to find [data-action] (manual closest() for max compat)
    while (target && target !== document.body) {
        if (target.dataset && target.dataset.action) break;
        target = target.parentElement;
    }
    if (!target || !target.dataset || !target.dataset.action) return;

    var action = target.dataset.action;

    var setupBoard = document.getElementById('setup-board');
    var joinForm = document.getElementById('setup-join-form');
    var hostForm = document.getElementById('setup-host-form');
    var setupScreen = document.getElementById('setup-screen');
    var appLayout = document.getElementById('app-layout');

    switch (action) {
        case 'setup-host':
            if (setupBoard) setupBoard.hidden = true;
            if (joinForm) joinForm.hidden = true;
            if (hostForm) hostForm.hidden = false;
            break;
        case 'setup-join':
            if (setupBoard) setupBoard.hidden = true;
            if (joinForm) joinForm.hidden = false;
            if (hostForm) hostForm.hidden = true;
            break;
        case 'setup-offline':
            if (setupScreen) setupScreen.hidden = true;
            if (appLayout) appLayout.hidden = false;
            break;
        case 'setup-back':
            if (setupBoard) setupBoard.hidden = false;
            if (joinForm) joinForm.hidden = true;
            if (hostForm) hostForm.hidden = true;
            break;
    }
}, false);

// iOS Safari (including standalone mode) needs a touchstart listener on
// the document for :active CSS states to fire on touch.  Without this,
// buttons get zero visual feedback.  This must be in the non-module script
// because the module may not load in standalone mode.
document.addEventListener('touchstart', function () {}, { passive: true });

// --- Module load failure detection ---
// If the ES module hasn't set __appModuleLoaded after 3 seconds, show an
// error with a reload button. This catches SRI mismatches, network failures,
// and stale service worker caches serving broken JS.
setTimeout(function () {
    if (window.__appModuleLoaded) return;

    // First attempt: clear all service worker caches and reload once.
    // A stale cache is the most common cause of module load failure on mobile
    // (SW serves old index.html whose SRI hash doesn't match the new JS bundle,
    // or browser maxAge cache serves old app.js that references non-existent chunks).
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

    // Second attempt also failed — show error UI.
    // The error must be shown on whichever screen is currently visible:
    // the setup screen (initial load) or the game board (mid-game reload).
    var setupScreen = document.getElementById('setup-screen');
    var board = document.getElementById('board');
    var setupVisible = setupScreen && !setupScreen.hidden;

    var errorHtml = '<p><strong>Game failed to load.</strong></p>' +
        '<p style="color:#a0a0b0;margin-top:8px;">This usually means a cached version of the game is outdated.<br>' +
        'Try clearing your browser cache or opening in a private/incognito window.</p>' +
        '<p style="margin-top:12px;">' +
        '<button id="reload-btn" style="padding:10px 24px;cursor:pointer;border-radius:6px;border:1px solid #555;background:#2a2a3e;color:#e0e0e0;font-size:1rem;touch-action:manipulation;">Reload Page</button>' +
        '</p>';

    if (setupVisible) {
        // Setup screen is showing — insert error below the subtitle
        var container = document.querySelector('.setup-board-container');
        var setupBoard = document.getElementById('setup-board');
        if (container && setupBoard) {
            setupBoard.hidden = true;
            var msg = document.createElement('div');
            msg.style.cssText = 'text-align:center;padding:30px 20px;color:#ff6b6b;font-size:1rem;';
            msg.innerHTML = errorHtml;
            container.appendChild(msg);
        }
    } else if (board && !board.querySelector('.card')) {
        // Game board visible but empty — show error there
        var loading = document.getElementById('board-loading');
        var msg = loading || document.createElement('div');
        msg.style.cssText = 'grid-column:1/-1;text-align:center;padding:40px;color:#ff6b6b;font-size:1rem;';
        msg.innerHTML = errorHtml;
        if (!loading) board.appendChild(msg);
    }

    var reloadBtn = document.getElementById('reload-btn');
    if (reloadBtn) {
        reloadBtn.addEventListener('click', function () { location.reload(); });
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
