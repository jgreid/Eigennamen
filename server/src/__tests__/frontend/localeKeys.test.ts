/**
 * Locale-key regression tests (P1-11).
 *
 * board.neutralCard (used by board.ts / game/reveal.ts screen-reader
 * announcements) and game.dangerZone / game.forfeitGame (used by
 * index.html's Settings modal data-i18n attributes) never existed in any
 * locale file — every screen-reader user heard the literal key string, and
 * non-English locales showed two stray English labels. Guards against the
 * same class of bug: every data-i18n* attribute in index.html, and every
 * screen-reader-announcement key hardcoded in board.ts/reveal.ts, must
 * resolve to a real string in all four locale files.
 */
import fs from 'fs';
import path from 'path';

const PUBLIC_DIR = path.join(__dirname, '../../../public');
const LOCALES = ['en', 'de', 'es', 'fr'] as const;

function loadLocale(lang: string): Record<string, unknown> {
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, 'locales', `${lang}.json`), 'utf-8');
    return JSON.parse(raw);
}

function resolvesToString(locale: Record<string, unknown>, dottedKey: string): boolean {
    const value = dottedKey.split('.').reduce<unknown>((acc, part) => {
        if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[part];
        }
        return undefined;
    }, locale);
    return typeof value === 'string' && value.length > 0;
}

const localeData: Record<string, Record<string, unknown>> = Object.fromEntries(
    LOCALES.map((lang) => [lang, loadLocale(lang)])
);

describe('locale key regressions (P1-11)', () => {
    describe('every data-i18n* attribute in index.html resolves in all locales', () => {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');
        const keys = new Set<string>();
        for (const attr of [
            'data-i18n',
            'data-i18n-placeholder',
            'data-i18n-title',
            'data-i18n-label',
            'data-i18n-arialabel',
        ]) {
            const re = new RegExp(`${attr}="([^"]+)"`, 'g');
            let m: RegExpExecArray | null;
            while ((m = re.exec(html)) !== null) {
                keys.add(m[1] as string);
            }
        }
        // Sanity check the scan itself found a realistic number of keys.
        it('found a non-trivial number of data-i18n keys to check', () => {
            expect(keys.size).toBeGreaterThan(50);
        });

        it.each(Array.from(keys).sort())('%s resolves in every locale', (key) => {
            for (const lang of LOCALES) {
                expect(resolvesToString(localeData[lang] as Record<string, unknown>, key)).toBe(true);
            }
        });
    });

    describe('screen-reader announcement keys hardcoded in board.ts / game/reveal.ts', () => {
        // The exact keys used by revealed-card announcements (typeNames maps in
        // frontend/board.ts and frontend/game/reveal.ts).
        const keys = ['rules.neutralCard', 'board.assassinCard'];

        it.each(keys)('%s resolves in every locale', (key) => {
            for (const lang of LOCALES) {
                expect(resolvesToString(localeData[lang] as Record<string, unknown>, key)).toBe(true);
            }
        });

        it('the removed phantom key board.neutralCard is not relied on anywhere', () => {
            const boardSource = fs.readFileSync(path.join(__dirname, '../../frontend/board.ts'), 'utf-8');
            const revealSource = fs.readFileSync(path.join(__dirname, '../../frontend/game/reveal.ts'), 'utf-8');
            expect(boardSource).not.toContain('board.neutralCard');
            expect(revealSource).not.toContain('board.neutralCard');
        });
    });

    describe('room:warning toast keys hardcoded in roomEventHandlers.ts (IMPROVEMENT_PLAN B5)', () => {
        // These t() calls live in TS, so the data-i18n scanner above cannot see
        // them; guard the whole set so a missing translation can't ship silently
        // (the SERVER_SHUTDOWN warning was previously dropped entirely).
        const keys = ['multiplayer.botStalled', 'multiplayer.botSeatReclaimed', 'multiplayer.serverShutdown'];

        it.each(keys)('%s resolves in every locale', (key) => {
            for (const lang of LOCALES) {
                expect(resolvesToString(localeData[lang] as Record<string, unknown>, key)).toBe(true);
            }
        });

        it('the shutdown warning is emitted with a { code } the client actually handles', () => {
            const socketSource = fs.readFileSync(path.join(__dirname, '../../socket/index.ts'), 'utf-8');
            const handlerSource = fs.readFileSync(
                path.join(__dirname, '../../frontend/handlers/roomEventHandlers.ts'),
                'utf-8'
            );
            // Server emits the { code, message } shape, not the old dropped `type` key.
            expect(socketSource).toContain("code: 'SERVER_SHUTDOWN'");
            expect(socketSource).not.toContain("type: 'server_shutdown'");
            // Client has a matching branch.
            expect(handlerSource).toContain("data.code === 'SERVER_SHUTDOWN'");
        });
    });

    describe('settings modal data-i18n keys are correct (not the phantom game.* variants)', () => {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');

        it('uses settings.dangerZone / settings.forfeitGame, not game.dangerZone / game.forfeitGame', () => {
            expect(html).toContain('data-i18n="settings.dangerZone"');
            expect(html).toContain('data-i18n="settings.forfeitGame"');
            expect(html).not.toContain('data-i18n="game.dangerZone"');
            expect(html).not.toContain('data-i18n="game.forfeitGame"');
        });

        it.each(['settings.dangerZone', 'settings.forfeitGame'])(
            '%s has a distinct translation in every locale',
            (key) => {
                for (const lang of LOCALES) {
                    const value = key
                        .split('.')
                        .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], localeData[lang]);
                    expect(typeof value).toBe('string');
                    expect((value as string).length).toBeGreaterThan(0);
                }
            }
        );
    });

    describe('multiplayer lifecycle/timer/reconnect toast keys (IMPROVEMENT_PLAN C5)', () => {
        // These t() calls live in TS handlers, so the data-i18n scanner cannot see
        // them; guard the whole set so a missing translation can't ship silently.
        const keys = [
            'multiplayer.playerJoined',
            'multiplayer.playerLeft',
            'multiplayer.playerDisconnected',
            'multiplayer.playerReconnected',
            'multiplayer.disconnectedFromServer',
            'multiplayer.reconnected',
            'multiplayer.reconnectedWithChanges',
            'multiplayer.previousGameGone',
            'multiplayer.couldNotRejoin',
            'multiplayer.kicked',
            'multiplayer.playerKicked',
            'multiplayer.settingsUpdated',
            'multiplayer.someone',
            'multiplayer.aPlayer',
            'multiplayer.changeGameStarted',
            'multiplayer.changeGameOverWon',
            'multiplayer.changeGameOver',
            'multiplayer.changeNowTurn',
            'multiplayer.changePlayerJoined',
            'multiplayer.changePlayersJoined',
            'multiplayer.changePlayerLeft',
            'multiplayer.changePlayersLeft',
            'timer.expired',
            'history.couldNotLoad',
            'history.couldNotLoadHistory',
        ];

        it.each(keys)('%s resolves in every locale', (key) => {
            for (const lang of LOCALES) {
                expect(resolvesToString(localeData[lang] as Record<string, unknown>, key)).toBe(true);
            }
        });

        // Lint-style guard: no showToast() call in the handler layer or the
        // reconnection sync may pass a raw string literal — every user-facing
        // toast must go through t(). This is the structural check the plain
        // data-i18n scan cannot perform (these sites bypass the DOM entirely).
        const HANDLERS_DIR = path.join(__dirname, '../../frontend/handlers');
        const scannedFiles = [
            ...fs
                .readdirSync(HANDLERS_DIR)
                .filter((f) => f.endsWith('.ts'))
                .map((f) => path.join(HANDLERS_DIR, f)),
            path.join(__dirname, '../../frontend/multiplayerSync.ts'),
            // N18 added setMpStatus() here as an i18n sink to guard.
            path.join(__dirname, '../../frontend/multiplayer.ts'),
        ];
        // User-facing sinks that bypass the DOM data-i18n scan. Every one must be
        // fed a t() result, never a raw literal. announceToScreenReader/setMpStatus
        // were added by N18 after real bypass strings shipped through them; the
        // `[^'"\`)]` requires a NON-EMPTY literal so empty-string clears
        // (setMpStatus('', '')) aren't false-flagged.
        const literalSinkPatterns = [
            /showToast\(\s*['"`]/,
            /announceToScreenReader\(\s*['"`][^'"`)]/,
            /setMpStatus\(\s*['"`][^'"`)]/,
        ];

        it('scans a realistic number of handler files', () => {
            expect(scannedFiles.length).toBeGreaterThan(4);
        });

        it.each(scannedFiles.map((f) => [path.basename(f), f] as const))(
            '%s has no hardcoded user-facing string literal (showToast / announceToScreenReader / setMpStatus)',
            (_name, file) => {
                const source = fs.readFileSync(file, 'utf-8');
                const offenders = source
                    .split('\n')
                    .map((line, i) => [i + 1, line] as const)
                    .filter(([, line]) => literalSinkPatterns.some((re) => re.test(line)));
                expect(offenders).toEqual([]);
            }
        );
    });

    describe('aria-label i18n (IMPROVEMENT_PLAN C6)', () => {
        const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf-8');

        // aria-labels that are intentionally left un-i18n'd (language-neutral or
        // set dynamically from state at runtime). Empty today — every static
        // aria-label in index.html carries a data-i18n-arialabel companion.
        const ALLOWLIST = new Set<string>();

        const ariaLabels = Array.from(html.matchAll(/aria-label="([^"]*)"/g)).map((m) => m[1] as string);
        const companionCount = (html.match(/data-i18n-arialabel="/g) || []).length;

        it('found a realistic number of aria-labels and companions', () => {
            expect(ariaLabels.length).toBeGreaterThan(20);
            expect(companionCount).toBeGreaterThan(20);
        });

        // Every static aria-label must be paired with a data-i18n-arialabel key
        // (or explicitly allowlisted) so screen-reader users get a translated
        // label in de/es/fr — the primary navigation surface for blind users.
        it('every static aria-label element has a data-i18n-arialabel companion', () => {
            // Each companion is stamped immediately before its aria-label, so the
            // two counts must match once allowlisted bare labels are excluded.
            const bare = ariaLabels.filter((label) => ALLOWLIST.has(label));
            expect(ariaLabels.length - bare.length).toBe(companionCount);
        });

        // The toast dismiss button is created dynamically, so it can't use the
        // attribute mechanism — it must resolve its label via t() at build time.
        it('the dynamic toast-dismiss label is routed through t()', () => {
            const uiSource = fs.readFileSync(path.join(__dirname, '../../frontend/ui.ts'), 'utf-8');
            expect(uiSource).toContain("t('aria.dismissNotification')");
            expect(uiSource).not.toContain("'Dismiss notification'");
            for (const lang of LOCALES) {
                expect(resolvesToString(localeData[lang] as Record<string, unknown>, 'aria.dismissNotification')).toBe(
                    true
                );
            }
        });

        // translatePage() must actually apply the aria-label branch, or the
        // stamped attributes are inert.
        it('translatePage() handles the data-i18n-arialabel attribute', () => {
            const i18nSource = fs.readFileSync(path.join(__dirname, '../../frontend/i18n.ts'), 'utf-8');
            expect(i18nSource).toContain('data-i18n-arialabel');
            expect(i18nSource).toContain("setAttribute('aria-label'");
        });
    });
});
