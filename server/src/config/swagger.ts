import swaggerUi from 'swagger-ui-express';

import type { Express, Request, Response } from 'express';

import { APP_VERSION } from './version';

const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Eigennamen Online API',
        version: APP_VERSION,
        description: `
REST API for Eigennamen Online multiplayer game server.

## Overview
This API provides endpoints for:
- **Rooms**: Create, join, and manage game rooms
- **Health**: Server health monitoring and metrics

## WebSocket Events
Real-time game events are handled via Socket.io (not documented here).
See the project README for WebSocket event documentation.
            `,
        license: {
            name: 'GPL-3.0',
            url: 'https://www.gnu.org/licenses/gpl-3.0.en.html',
        },
    },
    servers: [
        {
            url: '/api',
            description: 'API routes',
        },
        {
            url: '/',
            description: 'Root routes (health checks)',
        },
    ],
    tags: [
        { name: 'Health', description: 'Server health and monitoring endpoints' },
        { name: 'Rooms', description: 'Game room management' },
        { name: 'Replays', description: 'Finished-game replay retrieval' },
    ],
    components: {
        schemas: {
            Error: {
                type: 'object',
                properties: {
                    error: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                description: 'Error code for programmatic handling',
                            },
                            message: {
                                type: 'string',
                                description: 'Human-readable error message',
                            },
                        },
                    },
                },
            },
            HealthCheck: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['ok', 'live', 'ready', 'degraded', 'error'],
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time',
                    },
                    uptime: {
                        type: 'integer',
                        description: 'Server uptime in seconds',
                    },
                },
            },
            ReadinessCheck: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['ready', 'degraded', 'error'],
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time',
                    },
                    checks: {
                        type: 'object',
                        properties: {
                            redis: {
                                type: 'object',
                                properties: {
                                    healthy: { type: 'boolean' },
                                    mode: { type: 'string', enum: ['redis', 'memory'] },
                                },
                            },
                            pubsub: {
                                type: 'object',
                                properties: {
                                    healthy: { type: 'boolean' },
                                    status: { type: 'string' },
                                },
                            },
                        },
                    },
                },
            },
            Metrics: {
                type: 'object',
                properties: {
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: {
                        type: 'object',
                        properties: {
                            seconds: { type: 'integer' },
                            startTime: { type: 'string', format: 'date-time' },
                        },
                    },
                    memory: {
                        type: 'object',
                        properties: {
                            heapUsed: { type: 'string' },
                            heapTotal: { type: 'string' },
                            rss: { type: 'string' },
                        },
                    },
                    redis: {
                        type: 'object',
                        properties: {
                            mode: { type: 'string' },
                            healthy: { type: 'boolean' },
                        },
                    },
                },
            },
            RoomInfo: {
                type: 'object',
                properties: {
                    room: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                minLength: 3,
                                maxLength: 20,
                                pattern: '^[\\p{L}\\p{N}\\-_]+$',
                                description:
                                    '3–20 characters: Unicode letters/digits, hyphen, underscore. Case-insensitive; normalized to lowercase server-side.',
                            },
                            status: {
                                type: 'string',
                                enum: ['waiting', 'playing', 'finished'],
                            },
                            settings: {
                                type: 'object',
                                properties: {
                                    teamNames: {
                                        type: 'object',
                                        properties: {
                                            red: { type: 'string' },
                                            blue: { type: 'string' },
                                        },
                                    },
                                    allowSpectators: { type: 'boolean' },
                                },
                            },
                        },
                    },
                    playerCount: {
                        type: 'integer',
                        description: 'Number of players in the room',
                    },
                },
            },
            RoomExists: {
                type: 'object',
                properties: {
                    exists: {
                        type: 'boolean',
                        description: 'Whether the room exists',
                    },
                },
            },
        },
        securitySchemes: {
            sessionId: {
                type: 'apiKey',
                in: 'header',
                name: 'X-Session-Id',
                description:
                    'Player session ID. Sent as the X-Session-Id header to authorize replay access for a room the caller participated in.',
            },
        },
    },
    paths: {
        // Health endpoints
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Basic health check',
                description: 'Returns OK if server is running. Used for basic availability monitoring.',
                responses: {
                    '200': {
                        description: 'Server is healthy',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/HealthCheck' },
                            },
                        },
                    },
                },
            },
        },
        '/health/ready': {
            get: {
                tags: ['Health'],
                summary: 'Readiness check',
                description:
                    'Checks all dependencies (Redis, Pub/Sub). Returns 503 if any are unhealthy. Used by load balancers.',
                responses: {
                    '200': {
                        description: 'All dependencies healthy',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ReadinessCheck' },
                            },
                        },
                    },
                    '503': {
                        description: 'One or more dependencies unhealthy',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ReadinessCheck' },
                            },
                        },
                    },
                },
            },
        },
        '/health/live': {
            get: {
                tags: ['Health'],
                summary: 'Liveness probe',
                description: 'Returns 200 if event loop is responding. Used by Kubernetes liveness probes.',
                responses: {
                    '200': {
                        description: 'Process is alive',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/HealthCheck' },
                            },
                        },
                    },
                },
            },
        },
        '/health/metrics': {
            get: {
                tags: ['Health'],
                summary: 'Server metrics',
                description:
                    'Returns detailed server metrics including memory usage, uptime, and Redis status. ' +
                    'In production this endpoint requires HTTP Basic auth (password = ADMIN_PASSWORD) to ' +
                    'prevent reconnaissance; it is unauthenticated in development. ' +
                    '(/health, /health/ready and /health/live remain unauthenticated for load balancers.)',
                responses: {
                    '200': {
                        description: 'Metrics retrieved successfully',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Metrics' },
                            },
                        },
                    },
                    '401': {
                        description: 'Missing or invalid Basic auth credentials (production only)',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' },
                            },
                        },
                    },
                    '500': {
                        description: 'Failed to collect metrics',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' },
                            },
                        },
                    },
                },
            },
        },
        '/health/metrics/prometheus': {
            get: {
                tags: ['Health'],
                summary: 'Prometheus metrics',
                description:
                    'Returns metrics in Prometheus text exposition format for scraping. Same auth as ' +
                    '/health/metrics (HTTP Basic, password = ADMIN_PASSWORD, in production only).',
                responses: {
                    '200': {
                        description: 'Prometheus-format metrics',
                        content: {
                            'text/plain': {
                                schema: { type: 'string' },
                            },
                        },
                    },
                    '401': {
                        description: 'Missing or invalid Basic auth credentials (production only)',
                    },
                },
            },
        },
        // Room endpoints
        '/api/rooms/{code}/exists': {
            get: {
                tags: ['Rooms'],
                summary: 'Check if room exists',
                description: 'Quick check to see if a room code is valid and active.',
                parameters: [
                    {
                        name: 'code',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 20,
                            pattern: '^[\\p{L}\\p{N}\\-_]+$',
                        },
                        description:
                            '3–20 characters: Unicode letters/digits, hyphen, underscore. Case-insensitive (normalized to lowercase server-side).',
                    },
                ],
                responses: {
                    '200': {
                        description: 'Check completed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RoomExists' },
                            },
                        },
                    },
                    '400': {
                        description: 'Invalid room code format',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' },
                            },
                        },
                    },
                },
            },
        },
        '/api/rooms/{code}': {
            get: {
                tags: ['Rooms'],
                summary: 'Get room info',
                description: 'Get public information about a room including status, settings, and player count.',
                parameters: [
                    {
                        name: 'code',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 20,
                            pattern: '^[\\p{L}\\p{N}\\-_]+$',
                        },
                        description:
                            '3–20 characters: Unicode letters/digits, hyphen, underscore. Case-insensitive (normalized to lowercase server-side).',
                    },
                ],
                responses: {
                    '200': {
                        description: 'Room info retrieved',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RoomInfo' },
                            },
                        },
                    },
                    '400': {
                        description: 'Invalid room code format',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' },
                            },
                        },
                    },
                    '404': {
                        description: 'Room not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' },
                            },
                        },
                    },
                },
            },
        },
        '/api/replays/{roomCode}/{gameId}': {
            get: {
                tags: ['Replays'],
                summary: 'Get a game replay',
                description:
                    'Fetch the stored replay for a finished game. Requires an X-Session-Id header for a session that participated in the room (no room membership is otherwise needed). Rate-limited.',
                security: [{ sessionId: [] }],
                parameters: [
                    {
                        name: 'roomCode',
                        in: 'path',
                        required: true,
                        schema: {
                            type: 'string',
                            minLength: 3,
                            maxLength: 20,
                            pattern: '^[\\p{L}\\p{N}\\-_]+$',
                        },
                        description:
                            '3–20 characters: Unicode letters/digits, hyphen, underscore. Case-insensitive (normalized to lowercase server-side).',
                    },
                    {
                        name: 'gameId',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', format: 'uuid' },
                        description: "The finished game's ID (UUID).",
                    },
                ],
                responses: {
                    '200': {
                        description: 'Replay retrieved',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: { replay: { type: 'object' } },
                                },
                            },
                        },
                    },
                    '400': {
                        description: 'Invalid room code or game ID',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                    },
                    '401': {
                        description: 'Missing or invalid X-Session-Id header',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                    },
                    '403': {
                        description: 'Session did not participate in this room',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                    },
                    '404': {
                        description: 'Replay not found',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                    },
                    '429': {
                        description: 'Rate limit exceeded',
                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
                    },
                },
            },
        },
    },
};

export function setupSwagger(app: Express): void {
    app.use(
        '/api-docs',
        swaggerUi.serve,
        swaggerUi.setup(swaggerSpec, {
            customCss: '.swagger-ui .topbar { display: none }',
            customSiteTitle: 'Eigennamen API Documentation',
        })
    );

    app.get('/api-docs.json', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}

export { swaggerSpec };
