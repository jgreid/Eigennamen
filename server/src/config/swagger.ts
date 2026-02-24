/**
 * OpenAPI/Swagger Configuration
 *
 * Provides API documentation for the Eigennamen Online REST API.
 * Access documentation at /api-docs when server is running.
 *
 * The spec is defined inline — no file scanning needed, so swagger-jsdoc
 * is not required. swagger-ui-express serves the spec directly.
 */

import swaggerUi from 'swagger-ui-express';

import type { Express, Request, Response } from 'express';

const swaggerSpec = {
    openapi: '3.0.0',
    info: {
        title: 'Eigennamen Online API',
        version: '1.0.0',
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
            url: 'https://www.gnu.org/licenses/gpl-3.0.en.html'
        }
    },
    servers: [
        {
            url: '/api',
            description: 'API routes'
        },
        {
            url: '/',
            description: 'Root routes (health checks)'
        }
    ],
    tags: [
        { name: 'Health', description: 'Server health and monitoring endpoints' },
        { name: 'Rooms', description: 'Game room management' }
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
                                description: 'Error code for programmatic handling'
                            },
                            message: {
                                type: 'string',
                                description: 'Human-readable error message'
                            }
                        }
                    }
                }
            },
            HealthCheck: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['ok', 'live', 'ready', 'degraded', 'error']
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time'
                    },
                    uptime: {
                        type: 'integer',
                        description: 'Server uptime in seconds'
                    }
                }
            },
            ReadinessCheck: {
                type: 'object',
                properties: {
                    status: {
                        type: 'string',
                        enum: ['ready', 'degraded', 'error']
                    },
                    timestamp: {
                        type: 'string',
                        format: 'date-time'
                    },
                    checks: {
                        type: 'object',
                        properties: {
                            redis: {
                                type: 'object',
                                properties: {
                                    healthy: { type: 'boolean' },
                                    mode: { type: 'string', enum: ['redis', 'memory'] }
                                }
                            },
                            pubsub: {
                                type: 'object',
                                properties: {
                                    healthy: { type: 'boolean' },
                                    status: { type: 'string' }
                                }
                            }
                        }
                    }
                }
            },
            Metrics: {
                type: 'object',
                properties: {
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: {
                        type: 'object',
                        properties: {
                            seconds: { type: 'integer' },
                            startTime: { type: 'string', format: 'date-time' }
                        }
                    },
                    memory: {
                        type: 'object',
                        properties: {
                            heapUsed: { type: 'string' },
                            heapTotal: { type: 'string' },
                            rss: { type: 'string' }
                        }
                    },
                    redis: {
                        type: 'object',
                        properties: {
                            mode: { type: 'string' },
                            healthy: { type: 'boolean' }
                        }
                    }
                }
            },
            RoomInfo: {
                type: 'object',
                properties: {
                    room: {
                        type: 'object',
                        properties: {
                            code: {
                                type: 'string',
                                pattern: '^[A-Z0-9]{6}$',
                                description: '6-character room code'
                            },
                            status: {
                                type: 'string',
                                enum: ['waiting', 'playing', 'finished']
                            },
                            settings: {
                                type: 'object',
                                properties: {
                                    teamNames: {
                                        type: 'object',
                                        properties: {
                                            red: { type: 'string' },
                                            blue: { type: 'string' }
                                        }
                                    },
                                    allowSpectators: { type: 'boolean' }
                                }
                            }
                        }
                    },
                    playerCount: {
                        type: 'integer',
                        description: 'Number of players in the room'
                    }
                }
            },
            RoomExists: {
                type: 'object',
                properties: {
                    exists: {
                        type: 'boolean',
                        description: 'Whether the room exists'
                    }
                }
            }
        }
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
                                schema: { $ref: '#/components/schemas/HealthCheck' }
                            }
                        }
                    }
                }
            }
        },
        '/health/ready': {
            get: {
                tags: ['Health'],
                summary: 'Readiness check',
                description: 'Checks all dependencies (Redis, Pub/Sub). Returns 503 if any are unhealthy. Used by load balancers.',
                responses: {
                    '200': {
                        description: 'All dependencies healthy',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ReadinessCheck' }
                            }
                        }
                    },
                    '503': {
                        description: 'One or more dependencies unhealthy',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ReadinessCheck' }
                            }
                        }
                    }
                }
            }
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
                                schema: { $ref: '#/components/schemas/HealthCheck' }
                            }
                        }
                    }
                }
            }
        },
        '/metrics': {
            get: {
                tags: ['Health'],
                summary: 'Server metrics',
                description: 'Returns detailed server metrics including memory usage, uptime, and Redis status.',
                responses: {
                    '200': {
                        description: 'Metrics retrieved successfully',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Metrics' }
                            }
                        }
                    },
                    '500': {
                        description: 'Failed to collect metrics',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    }
                }
            }
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
                        schema: { type: 'string', pattern: '^[A-Za-z0-9]{6}$' },
                        description: '6-character room code (case-insensitive)'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Check completed',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RoomExists' }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid room code format',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    }
                }
            }
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
                        schema: { type: 'string', pattern: '^[A-Za-z0-9]{6}$' },
                        description: '6-character room code (case-insensitive)'
                    }
                ],
                responses: {
                    '200': {
                        description: 'Room info retrieved',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/RoomInfo' }
                            }
                        }
                    },
                    '400': {
                        description: 'Invalid room code format',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    },
                    '404': {
                        description: 'Room not found',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/Error' }
                            }
                        }
                    }
                }
            }
        }
    }
};

export function setupSwagger(app: Express): void {
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Eigennamen API Documentation'
    }));

    app.get('/api-docs.json', (_req: Request, res: Response) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}

export { swaggerSpec };
