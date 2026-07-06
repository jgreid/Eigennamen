/**
 * Mock-vs-real Redis fidelity guard.
 *
 * `createMockRedis` stands in for the node-redis v5 client in ~all backend
 * tests. When it diverges from the real client's return shapes, it can certify
 * a broken call as passing — which is exactly how the scanIterator (D3),
 * WatchError (B3), zRange-WITHSCORES (D4), and numeric-SCAN-cursor bugs shipped.
 *
 * This suite runs the same operation against the mock AND a real embedded Redis
 * and asserts they agree, so any future divergence fails here instead of hiding
 * a production bug. Add a case whenever the mock gains a method or the client
 * is upgraded.
 */
process.env['REDIS_URL'] = 'memory';
import { connectRedis, disconnectRedis, getRedis } from '../../config/redis';

const { createMockRedis } = require('../helpers/mocks');

type R = any;
interface Case {
    name: string;
    fn: (r: R, ns: string) => Promise<unknown>;
    normalize?: (x: unknown) => unknown;
}

const sortIfArray = (x: unknown) => (Array.isArray(x) ? [...x].sort() : x);

const cases: Case[] = [
    { name: 'set → OK', fn: (r, ns) => r.set(`${ns}:k`, 'v') },
    {
        name: 'set NX on existing → null',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v');
            return r.set(`${ns}:k`, 'v2', { NX: true });
        },
    },
    { name: 'get missing → null', fn: (r, ns) => r.get(`${ns}:missing`) },
    {
        name: 'del(array) returns deleted count',
        fn: async (r, ns) => {
            await r.set(`${ns}:a`, '1');
            await r.set(`${ns}:b`, '2');
            return r.del([`${ns}:a`, `${ns}:b`, `${ns}:missing`]);
        },
    },
    { name: 'exists missing → 0', fn: (r, ns) => r.exists(`${ns}:missing`) },
    {
        name: 'exists present → 1',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v');
            return r.exists(`${ns}:k`);
        },
    },
    {
        name: 'mGet mixed present/missing',
        fn: async (r, ns) => {
            await r.set(`${ns}:a`, '1');
            return r.mGet([`${ns}:a`, `${ns}:missing`]);
        },
    },
    { name: 'ttl missing key → -2', fn: (r, ns) => r.ttl(`${ns}:missing`) },
    {
        name: 'ttl no-expiry key → -1',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v');
            return r.ttl(`${ns}:k`);
        },
    },
    { name: 'expire on missing key → 0', fn: (r, ns) => r.expire(`${ns}:missing`, 60) },
    {
        name: 'expire on present key → 1',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v');
            return r.expire(`${ns}:k`, 60);
        },
    },
    { name: 'sAdd new member → 1', fn: (r, ns) => r.sAdd(`${ns}:s`, 'm1') },
    {
        name: 'sAdd duplicate → 0',
        fn: async (r, ns) => {
            await r.sAdd(`${ns}:s`, 'm1');
            return r.sAdd(`${ns}:s`, 'm1');
        },
    },
    {
        name: 'sMembers (order-insensitive)',
        normalize: sortIfArray,
        fn: async (r, ns) => {
            await r.sAdd(`${ns}:s`, 'a');
            await r.sAdd(`${ns}:s`, 'b');
            return r.sMembers(`${ns}:s`);
        },
    },
    {
        name: 'sIsMember present',
        fn: async (r, ns) => {
            await r.sAdd(`${ns}:s`, 'm1');
            return r.sIsMember(`${ns}:s`, 'm1');
        },
    },
    { name: 'sIsMember absent', fn: (r, ns) => r.sIsMember(`${ns}:s`, 'nope') },
    {
        name: 'sCard',
        fn: async (r, ns) => {
            await r.sAdd(`${ns}:s`, 'a');
            await r.sAdd(`${ns}:s`, 'b');
            return r.sCard(`${ns}:s`);
        },
    },
    {
        name: 'sRem count',
        fn: async (r, ns) => {
            await r.sAdd(`${ns}:s`, 'a');
            return r.sRem(`${ns}:s`, 'a');
        },
    },
    { name: 'zAdd new → 1', fn: (r, ns) => r.zAdd(`${ns}:z`, { score: 1, value: 'a' }) },
    {
        name: 'zAdd existing member (upsert) → 0',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            return r.zAdd(`${ns}:z`, { score: 2, value: 'a' });
        },
    },
    {
        name: 'zCard after upsert has no duplicate',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            await r.zAdd(`${ns}:z`, { score: 2, value: 'a' });
            return r.zCard(`${ns}:z`);
        },
    },
    {
        name: 'zRange members (score order)',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 2, value: 'b' });
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            return r.zRange(`${ns}:z`, 0, -1);
        },
    },
    {
        name: 'zRange REV',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 2, value: 'b' });
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            return r.zRange(`${ns}:z`, 0, -1, { REV: true });
        },
    },
    {
        name: 'zRangeWithScores returns { value, score } objects',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 100, value: 'a' });
            await r.zAdd(`${ns}:z`, { score: 200, value: 'b' });
            return r.zRangeWithScores(`${ns}:z`, 0, 0);
        },
    },
    {
        name: 'zRangeByScore',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            await r.zAdd(`${ns}:z`, { score: 5, value: 'b' });
            await r.zAdd(`${ns}:z`, { score: 9, value: 'c' });
            return r.zRangeByScore(`${ns}:z`, 2, 10);
        },
    },
    {
        name: 'zRem count',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            return r.zRem(`${ns}:z`, 'a');
        },
    },
    {
        name: 'zRemRangeByRank removes the lowest-ranked and returns count',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            await r.zAdd(`${ns}:z`, { score: 2, value: 'b' });
            await r.zAdd(`${ns}:z`, { score: 3, value: 'c' });
            const removed = await r.zRemRangeByRank(`${ns}:z`, 0, 0);
            const rest = await r.zRange(`${ns}:z`, 0, -1);
            return { removed, rest };
        },
    },
    {
        name: 'del clears a sorted set',
        fn: async (r, ns) => {
            await r.zAdd(`${ns}:z`, { score: 1, value: 'a' });
            await r.del(`${ns}:z`);
            return r.zCard(`${ns}:z`);
        },
    },
    {
        name: 'multi/exec success → array of replies (not [err,res] tuples)',
        fn: async (r, ns) => {
            const res = await r.multi().set(`${ns}:k`, 'v').exec();
            return { isArray: Array.isArray(res), first: res?.[0] };
        },
    },
    {
        name: 'multi/exec on a dirty WATCH throws WatchError',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v1');
            await r.watch(`${ns}:k`);
            await r.set(`${ns}:k`, 'v2');
            try {
                await r.multi().set(`${ns}:k`, 'v3').exec();
                return 'NO_THROW';
            } catch (e) {
                return `THREW:${(e as Error).constructor.name}`;
            }
        },
    },
    {
        name: 'multi/exec on a clean WATCH commits',
        fn: async (r, ns) => {
            await r.set(`${ns}:k`, 'v1');
            await r.watch(`${ns}:k`);
            await r.multi().set(`${ns}:k`, 'v3').exec();
            return r.get(`${ns}:k`);
        },
    },
    {
        name: 'list lPush/lRange round trip',
        fn: async (r, ns) => {
            await r.lPush(`${ns}:l`, 'a');
            await r.lPush(`${ns}:l`, 'b');
            return r.lRange(`${ns}:l`, 0, -1);
        },
    },
    {
        name: 'lLen',
        fn: async (r, ns) => {
            await r.lPush(`${ns}:l`, 'a');
            await r.lPush(`${ns}:l`, 'b');
            return r.lLen(`${ns}:l`);
        },
    },
    {
        name: 'lTrim then lRange',
        fn: async (r, ns) => {
            await r.lPush(`${ns}:l`, 'c');
            await r.lPush(`${ns}:l`, 'b');
            await r.lPush(`${ns}:l`, 'a');
            await r.lTrim(`${ns}:l`, 0, 1);
            return r.lRange(`${ns}:l`, 0, -1);
        },
    },
    {
        name: 'scan uses a string cursor and returns a string cursor',
        fn: async (r, ns) => {
            await r.set(`${ns}:sk`, 'v');
            const res = await r.scan('0', { MATCH: `${ns}:*`, COUNT: 100 });
            return { cursorType: typeof res.cursor, keys: res.keys };
        },
    },
    {
        name: 'scanIterator yields batches (arrays), not individual keys',
        fn: async (r, ns) => {
            await r.set(`${ns}:a`, '1');
            await r.set(`${ns}:b`, '2');
            const shapes: string[] = [];
            for await (const page of r.scanIterator({ MATCH: `${ns}:*`, COUNT: 100 })) {
                shapes.push(Array.isArray(page) ? 'array' : typeof page);
            }
            return shapes;
        },
    },
];

describe('mock-vs-real Redis fidelity', () => {
    let real: R;
    let mock: R;
    beforeAll(async () => {
        await connectRedis();
        real = getRedis();
        mock = createMockRedis();
    }, 20000);
    afterAll(async () => {
        await disconnectRedis();
    }, 20000);

    it.each(cases.map((c, i) => [c.name, c, i] as const))('mock matches real: %s', async (_name, c, i) => {
        const norm = c.normalize ?? ((x: unknown) => x);
        // Same namespace for both — mock and real are independent stores, so
        // there's no collision, and it keeps returned key names comparable.
        const ns = `fid${i}`;
        const mockRes = norm(await c.fn(mock, ns));
        const realRes = norm(await c.fn(real, ns));
        expect(mockRes).toEqual(realRes);
    });

    // Regression for the numeric-SCAN-cursor bug the admin routes shipped: the
    // real client rejects a numeric cursor, and a number-vs-string terminator
    // never ends. This replicates the production scan loop against real Redis.
    it('a production-style SCAN loop counts room keys with a string cursor', async () => {
        const redis = getRedis();
        await redis.set('room:AAA111', '{}');
        await redis.set('room:BBB222', '{}');
        await redis.set('room:AAA111:players', '[]'); // sub-key, must be excluded

        let cursor = '0';
        let count = 0;
        let iterations = 0;
        do {
            const result = await redis.scan(cursor, { MATCH: 'room:*', COUNT: 100 });
            cursor = result.cursor;
            iterations++;
            count += result.keys.filter((k: string) => /^room:[\p{L}\p{N}\-_]{3,20}$/u.test(k)).length;
        } while (cursor !== '0' && iterations < 1000);

        expect(count).toBe(2);
        expect(iterations).toBeLessThan(1000); // terminated normally, no runaway
    });

    it('the real client rejects a numeric SCAN cursor (the shipped bug)', async () => {
        const redis: R = getRedis();
        // @ts-expect-error deliberately the wrong (numeric) cursor type
        await expect(redis.scan(0, { MATCH: 'room:*', COUNT: 100 })).rejects.toThrow();
    });
});
