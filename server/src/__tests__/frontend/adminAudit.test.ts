/**
 * Admin dashboard — Audit Log smoke test (F3)
 *
 * Loads the real admin.html body + admin.js in jsdom with a mocked fetch and
 * asserts the Audit Log table renders the returned entries. Complements the
 * route-level coverage in routes/auditRoutes.test.ts.
 */

const fs = require('fs');
const path = require('path');

const auditPayload = {
    summary: { total: 2, admin: 1, security: 1, bySeverity: { high: 1, low: 1 } },
    logs: [
        {
            timestamp: '2026-07-06T12:00:00.000Z',
            event: 'security.suspicious',
            actor: 'anon',
            target: null,
            ip: '1.2.3.4',
            metadata: {},
            severity: 'high',
        },
        {
            timestamp: '2026-07-06T12:01:00.000Z',
            event: 'admin.room_closed',
            actor: 'admin',
            target: 'ROOM1',
            ip: null,
            metadata: {},
            severity: 'low',
        },
    ],
};

function mockFetch(url: unknown): Promise<{ ok: boolean; json: () => Promise<unknown> }> {
    const u = String(url);
    let body: unknown = {};
    if (u.includes('/api/audit')) body = auditPayload;
    else if (u.includes('/api/stats'))
        body = {
            timestamp: new Date('2026-07-06T12:00:00.000Z').toISOString(),
            uptime: { seconds: 1, formatted: '1s' },
            memory: { heapUsed: 1, heapTotal: 1, rss: 1, external: 1 },
            connections: { sockets: 0, activeRooms: 0 },
            health: { redis: { healthy: true, mode: 'memory' }, database: { enabled: false } },
            rateLimits: { http: { totalRequests: 0, blockedRequests: 0, blockRate: '0%' } },
            metrics: { counters: {}, gauges: {} },
            instance: { pid: 1, nodeVersion: 'v22', flyAllocId: null, flyRegion: null },
        };
    else if (u.includes('/api/rooms')) body = { rooms: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

describe('Admin dashboard audit log (F3)', () => {
    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.join(__dirname, '../../../public/admin.html'), 'utf8');
        const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
        document.body.innerHTML = bodyMatch ? bodyMatch[1] : '';

        (global as Record<string, unknown>).fetch = jest.fn(mockFetch);
        // Neutralize the 10s auto-refresh interval so the test doesn't leave a timer.
        jest.spyOn(global, 'setInterval').mockReturnValue(0 as unknown as NodeJS.Timeout);
        // fetchStats/fetchRooms touch stat/health widgets that are orthogonal to the
        // audit table under test; swallow their incidental console noise.
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('renders audit entries into the table on load', async () => {
        require('../../../public/js/admin.js');

        // Flush the fetch → json → render microtasks.
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));

        const container = document.getElementById('audit-container');
        expect(container?.querySelector('table.audit-table')).not.toBeNull();
        const rows = container?.querySelectorAll('tbody tr') ?? [];
        expect(rows.length).toBe(2);
        expect(container?.textContent).toContain('security.suspicious');
        expect(container?.textContent).toContain('admin.room_closed');

        const summary = document.getElementById('audit-summary');
        expect(summary?.textContent).toContain('Total: 2');
        expect(summary?.textContent).toContain('Security: 1');

        // The audit endpoint was actually queried.
        expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/admin/api/audit'));
    });
});
