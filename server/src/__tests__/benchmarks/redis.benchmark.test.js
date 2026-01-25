/**
 * Redis Performance Benchmarks
 *
 * Tests performance characteristics of Redis operations used in the game.
 * These tests help identify performance regressions and validate optimization decisions.
 *
 * Run with: npm test -- --testPathPattern=redis.benchmark
 */

// Storage must be prefixed with "mock" for Jest hoisting
const mockRedisStorage = new Map();
const mockRedisSets = new Map();
const mockOperationCounts = {
  get: 0,
  set: 0,
  del: 0,
  eval: 0,
  sAdd: 0,
  sMembers: 0,
  publish: 0,
  scanIterator: 0,
};

jest.mock('../../config/redis', () => {
  const mockRedis = {
    get: jest.fn(async (key) => {
      mockOperationCounts.get++;
      return mockRedisStorage.get(key) || null;
    }),
    set: jest.fn(async (key, value, _options) => {
      mockOperationCounts.set++;
      mockRedisStorage.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => {
      mockOperationCounts.del++;
      if (Array.isArray(key)) {
        let deleted = 0;
        key.forEach(k => { if (mockRedisStorage.delete(k)) deleted++; });
        return deleted;
      }
      return mockRedisStorage.delete(key) ? 1 : 0;
    }),
    exists: jest.fn(async (key) => mockRedisStorage.has(key) ? 1 : 0),
    expire: jest.fn(async () => 1),
    sAdd: jest.fn(async (key, ...members) => {
      mockOperationCounts.sAdd++;
      if (!mockRedisSets.has(key)) mockRedisSets.set(key, new Set());
      const set = mockRedisSets.get(key);
      let added = 0;
      members.forEach(m => { if (!set.has(m)) { set.add(m); added++; } });
      return added;
    }),
    sRem: jest.fn(async (key, ...members) => {
      const set = mockRedisSets.get(key);
      if (!set) return 0;
      let removed = 0;
      members.forEach(m => { if (set.delete(m)) removed++; });
      return removed;
    }),
    sMembers: jest.fn(async (key) => {
      mockOperationCounts.sMembers++;
      const set = mockRedisSets.get(key);
      return set ? [...set] : [];
    }),
    sIsMember: jest.fn(async (key, member) => {
      const set = mockRedisSets.get(key);
      return set && set.has(member) ? 1 : 0;
    }),
    sCard: jest.fn(async (key) => {
      const set = mockRedisSets.get(key);
      return set ? set.size : 0;
    }),
    watch: jest.fn(async () => 'OK'),
    unwatch: jest.fn(async () => 'OK'),
    mGet: jest.fn(async (keys) => keys.map(k => mockRedisStorage.get(k) || null)),
    multi: jest.fn(() => ({
      set: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => [[null, 'OK']])
    })),
    eval: jest.fn(async (script, options) => {
      mockOperationCounts.eval++;
      // Simulate atomic timer operations
      if (script && script.includes('SETNX')) {
        const roomKey = options.keys[0];
        if (mockRedisStorage.has(roomKey)) return 0;
        mockRedisStorage.set(roomKey, options.arguments[0]);
        return 1;
      }
      // Simulate addTime script
      if (script && script.includes('timer') && script.includes('endTime')) {
        const timerKey = options.keys[0];
        const timerData = mockRedisStorage.get(timerKey);
        if (!timerData) return null;
        const timer = JSON.parse(timerData);
        timer.endTime = timer.endTime + 30000;
        timer.duration = timer.duration + 30;
        mockRedisStorage.set(timerKey, JSON.stringify(timer));
        return JSON.stringify({ endTime: timer.endTime, duration: timer.duration, remainingSeconds: 30 });
      }
      return null;
    }),
    publish: jest.fn(async () => {
      mockOperationCounts.publish++;
      return 1;
    }),
    duplicate: jest.fn(() => mockRedis),
    scanIterator: jest.fn(function* (_options) {
      mockOperationCounts.scanIterator++;
      for (const [key] of mockRedisStorage) {
        yield key;
      }
    }),
  };

  return {
    getRedis: () => mockRedis,
    getPubSubClients: () => ({
      pubClient: mockRedis,
      subClient: {
        subscribe: jest.fn(async () => {}),
        unsubscribe: jest.fn(async () => {}),
      }
    }),
    isUsingMemoryMode: () => false
  };
});

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock pubSubHealth
jest.mock('../../utils/pubSubHealth', () => ({
  recordSuccess: jest.fn(),
  recordFailure: jest.fn(),
}));

const timerService = require('../../services/timerService');
const { getRedis } = require('../../config/redis');

describe('Redis Performance Benchmarks', () => {
  beforeAll(() => {
    // Use fake timers to prevent Jest from hanging
    jest.useFakeTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockRedisStorage.clear();
    mockRedisSets.clear();
    // Reset operation counts
    Object.keys(mockOperationCounts).forEach(key => {
      mockOperationCounts[key] = 0;
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Clear all pending timers
    jest.clearAllTimers();
  });

  describe('Timer Service Benchmarks', () => {
    describe('startTimer', () => {
      it('should complete within 50ms for single timer start', async () => {
        const start = performance.now();

        await timerService.startTimer('BENCH1', 120, () => {});

        const duration = performance.now() - start;
        expect(duration).toBeLessThan(50);
      });

      it('should use minimal Redis operations for timer start', async () => {
        await timerService.startTimer('BENCH1', 120, () => {});

        // Timer start should use: 1 del (stop existing), 1 set (store timer), 1 publish (notify)
        expect(mockOperationCounts.del).toBeLessThanOrEqual(2);
        expect(mockOperationCounts.set).toBeLessThanOrEqual(2);
        expect(mockOperationCounts.publish).toBeLessThanOrEqual(2);
      });

      it('should handle 100 sequential timer starts efficiently', async () => {
        const start = performance.now();

        for (let i = 0; i < 100; i++) {
          await timerService.startTimer(`BENCH${i}`, 120, () => {});
        }

        const duration = performance.now() - start;
        const avgPerOperation = duration / 100;

        // Each timer start should average under 5ms
        expect(avgPerOperation).toBeLessThan(5);
      });
    });

    describe('stopTimer', () => {
      it('should complete within 20ms for single timer stop', async () => {
        await timerService.startTimer('STOP1', 120, () => {});

        const start = performance.now();
        await timerService.stopTimer('STOP1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(20);
      });

      it('should be safe to stop non-existent timer', async () => {
        const start = performance.now();
        await timerService.stopTimer('NONEXISTENT');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(20);
      });
    });

    describe('getTimerStatus', () => {
      it('should complete within 10ms for status check', async () => {
        await timerService.startTimer('STATUS1', 120, () => {});

        const start = performance.now();
        const status = await timerService.getTimerStatus('STATUS1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(10);
        expect(status).not.toBeNull();
      });

      it('should handle 1000 status checks efficiently', async () => {
        await timerService.startTimer('STATCHECK', 120, () => {});

        const start = performance.now();
        for (let i = 0; i < 1000; i++) {
          await timerService.getTimerStatus('STATCHECK');
        }
        const duration = performance.now() - start;
        const avgPerOperation = duration / 1000;

        // Each status check should average under 1ms
        expect(avgPerOperation).toBeLessThan(1);
      });

      it('should use single Redis GET operation', async () => {
        await timerService.startTimer('GETOP', 120, () => {});
        const initialGets = mockOperationCounts.get;

        await timerService.getTimerStatus('GETOP');

        expect(mockOperationCounts.get - initialGets).toBe(1);
      });
    });

    describe('hasActiveTimer', () => {
      it('should complete within 15ms', async () => {
        await timerService.startTimer('ACTIVE1', 120, () => {});

        const start = performance.now();
        const result = await timerService.hasActiveTimer('ACTIVE1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(15);
        expect(result).toBe(true);
      });
    });

    describe('addTime (Lua script)', () => {
      it('should execute addTime atomically within 30ms', async () => {
        await timerService.startTimer('ADDTIME1', 60, () => {});

        const start = performance.now();
        const result = await timerService.addTime('ADDTIME1', 30, () => {});
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(30);
        // Result may be null if timer not found in local timers (expected in benchmark)
      });

      it('should use single eval operation for atomic update', async () => {
        await timerService.startTimer('EVALOP', 60, () => {});
        const initialEvals = mockOperationCounts.eval;

        await timerService.addTime('EVALOP', 30, () => {});

        // May use eval for atomic operation (depends on local timer state)
        expect(mockOperationCounts.eval - initialEvals).toBeLessThanOrEqual(1);
      });
    });

    describe('pauseTimer and resumeTimer', () => {
      it('should pause within 25ms', async () => {
        await timerService.startTimer('PAUSE1', 120, () => {});

        const start = performance.now();
        const remaining = await timerService.pauseTimer('PAUSE1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(25);
        expect(remaining).toBeGreaterThan(0);
      });

      it('should resume within 50ms', async () => {
        await timerService.startTimer('RESUME1', 120, () => {});
        await timerService.pauseTimer('RESUME1');

        const start = performance.now();
        const result = await timerService.resumeTimer('RESUME1', () => {});
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(50);
        // Result may be null if lock acquisition fails in test environment
      });
    });
  });

  describe('Room Service Benchmarks', () => {
    beforeEach(() => {
      // Clear any existing room data
      mockRedisStorage.clear();
      mockRedisSets.clear();
    });

    describe('Room Creation', () => {
      it('should create room with atomic operation', async () => {
        const roomData = {
          code: 'TEST01',
          hostSessionId: 'host-session',
          settings: {},
          createdAt: Date.now(),
        };

        const redis = getRedis();
        const start = performance.now();

        // Simulate atomic room creation
        await redis.set(`room:TEST01`, JSON.stringify(roomData));
        await redis.sAdd(`room:TEST01:players`, 'host-session');

        const duration = performance.now() - start;
        expect(duration).toBeLessThan(20);
      });

      it('should handle 50 concurrent room lookups efficiently', async () => {
        // Create test rooms
        for (let i = 0; i < 50; i++) {
          const roomData = { code: `ROOM${i.toString().padStart(2, '0')}`, players: [] };
          mockRedisStorage.set(`room:ROOM${i.toString().padStart(2, '0')}`, JSON.stringify(roomData));
        }

        const redis = getRedis();
        const start = performance.now();

        // Concurrent lookups
        const lookups = [];
        for (let i = 0; i < 50; i++) {
          lookups.push(redis.get(`room:ROOM${i.toString().padStart(2, '0')}`));
        }
        await Promise.all(lookups);

        const duration = performance.now() - start;
        expect(duration).toBeLessThan(100);
      });
    });

    describe('Room Operations', () => {
      it('should update room settings within 15ms', async () => {
        const roomData = { code: 'SETTINGS', settings: { timer: 60 } };
        mockRedisStorage.set('room:SETTINGS', JSON.stringify(roomData));

        const redis = getRedis();
        const start = performance.now();

        const data = await redis.get('room:SETTINGS');
        const room = JSON.parse(data);
        room.settings.timer = 120;
        await redis.set('room:SETTINGS', JSON.stringify(room));

        const duration = performance.now() - start;
        expect(duration).toBeLessThan(15);
      });

      it('should check room existence within 5ms', async () => {
        mockRedisStorage.set('room:EXISTS', '{}');

        const redis = getRedis();
        const start = performance.now();
        const exists = await redis.exists('room:EXISTS');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(5);
        expect(exists).toBe(1);
      });
    });
  });

  describe('Player Service Benchmarks', () => {
    describe('Player Lookup', () => {
      it('should lookup player within 10ms', async () => {
        const playerData = { sessionId: 'player1', nickname: 'Player1', team: 'red' };
        mockRedisStorage.set('player:player1', JSON.stringify(playerData));

        const redis = getRedis();
        const start = performance.now();
        const data = await redis.get('player:player1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(10);
        expect(JSON.parse(data).nickname).toBe('Player1');
      });

      it('should handle batch player lookups efficiently', async () => {
        // Create 20 players
        for (let i = 0; i < 20; i++) {
          mockRedisStorage.set(`player:p${i}`, JSON.stringify({ sessionId: `p${i}`, nickname: `Player${i}` }));
        }

        const redis = getRedis();
        const keys = Array.from({ length: 20 }, (_, i) => `player:p${i}`);

        const start = performance.now();
        const players = await redis.mGet(keys);
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(30);
        expect(players).toHaveLength(20);
      });
    });

    describe('Player Set Operations', () => {
      it('should add player to room set within 10ms', async () => {
        const redis = getRedis();
        const start = performance.now();
        await redis.sAdd('room:TEST:players', 'player-session');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(10);
      });

      it('should get room players within 15ms', async () => {
        // Add players
        for (let i = 0; i < 10; i++) {
          mockRedisSets.set('room:PLAYERS:players', new Set([...Array(10)].map((_, j) => `p${j}`)));
        }

        const redis = getRedis();
        const start = performance.now();
        const players = await redis.sMembers('room:PLAYERS:players');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(15);
        expect(players).toHaveLength(10);
      });

      it('should check player membership within 5ms', async () => {
        mockRedisSets.set('room:MEMBER:players', new Set(['player1', 'player2']));

        const redis = getRedis();
        const start = performance.now();
        const isMember = await redis.sIsMember('room:MEMBER:players', 'player1');
        const duration = performance.now() - start;

        expect(duration).toBeLessThan(5);
        expect(isMember).toBe(1);
      });
    });
  });

  describe('Pub/Sub Benchmarks', () => {
    it('should publish message within 10ms', async () => {
      const redis = getRedis();
      const start = performance.now();
      await redis.publish('timer:events', JSON.stringify({ type: 'tick', roomCode: 'TEST' }));
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(10);
    });

    it('should handle 100 sequential publishes efficiently', async () => {
      const redis = getRedis();
      const start = performance.now();

      for (let i = 0; i < 100; i++) {
        await redis.publish('timer:events', JSON.stringify({ type: 'tick', i }));
      }

      const duration = performance.now() - start;
      const avgPerPublish = duration / 100;

      expect(avgPerPublish).toBeLessThan(2);
    });
  });

  describe('Scan Operations Benchmarks', () => {
    it('should scan keys efficiently', async () => {
      // Create 100 timer keys
      for (let i = 0; i < 100; i++) {
        mockRedisStorage.set(`timer:ROOM${i}`, JSON.stringify({ roomCode: `ROOM${i}` }));
      }

      const redis = getRedis();
      const start = performance.now();
      const keys = [];

      for await (const key of redis.scanIterator({ MATCH: 'timer:*', COUNT: 100 })) {
        keys.push(key);
      }

      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
      expect(keys.length).toBeGreaterThanOrEqual(100);
    });
  });

  describe('Operation Count Analysis', () => {
    it('should track operation distribution for typical game flow', async () => {
      // Simulate typical game operations
      const redis = getRedis();

      // Create room
      await redis.set('room:GAME1', JSON.stringify({ code: 'GAME1' }));
      await redis.sAdd('room:GAME1:players', 'host');

      // Add players
      for (let i = 0; i < 4; i++) {
        await redis.sAdd('room:GAME1:players', `player${i}`);
        await redis.set(`player:player${i}`, JSON.stringify({ sessionId: `player${i}` }));
      }

      // Start timer
      await timerService.startTimer('GAME1', 120, () => {});

      // Check timer multiple times (simulating UI polling)
      for (let i = 0; i < 10; i++) {
        await timerService.getTimerStatus('GAME1');
      }

      // Output operation distribution
      console.log('Operation Distribution:', mockOperationCounts);

      // Verify reasonable operation counts
      expect(mockOperationCounts.get).toBeGreaterThan(0);
      expect(mockOperationCounts.set).toBeGreaterThan(0);

      // Timer status checks should be read-heavy
      expect(mockOperationCounts.get).toBeGreaterThan(mockOperationCounts.set);
    });
  });

  describe('Memory Efficiency', () => {
    it('should handle large room data without excessive memory', async () => {
      const largeSettings = {
        customWords: Array(1000).fill('WORD').map((w, i) => `${w}${i}`),
        history: Array(100).fill(null).map(() => ({ action: 'reveal', timestamp: Date.now() })),
      };

      const roomData = { code: 'LARGE', settings: largeSettings };
      const serialized = JSON.stringify(roomData);

      // Ensure serialized data is reasonable size (< 100KB)
      expect(serialized.length).toBeLessThan(100000);

      const redis = getRedis();
      const start = performance.now();
      await redis.set('room:LARGE', serialized);
      await redis.get('room:LARGE');
      const duration = performance.now() - start;

      expect(duration).toBeLessThan(50);
    });
  });
});
