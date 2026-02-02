/**
 * OpenAPI/Swagger Configuration
 *
 * Provides API documentation for the Codenames Online REST API.
 * Access documentation at /api-docs when server is running.
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Codenames Online API',
            version: '1.0.0',
            description: `
REST API for Codenames Online multiplayer game server.

## Overview
This API provides endpoints for:
- **Rooms**: Create, join, and manage game rooms
- **Word Lists**: Custom word list management
- **Health**: Server health monitoring and metrics

## Authentication
Most endpoints are public. Word list creation/modification requires JWT authentication.

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
            { name: 'Rooms', description: 'Game room management' },
            { name: 'Word Lists', description: 'Custom word list management' }
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
                },
                WordList: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            format: 'uuid'
                        },
                        name: {
                            type: 'string',
                            maxLength: 100
                        },
                        description: {
                            type: 'string',
                            maxLength: 500
                        },
                        words: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 25
                        },
                        wordCount: {
                            type: 'integer'
                        },
                        isPublic: {
                            type: 'boolean'
                        },
                        ownerId: {
                            type: 'string'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time'
                        }
                    }
                },
                WordListSummary: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', format: 'uuid' },
                        name: { type: 'string' },
                        description: { type: 'string' },
                        wordCount: { type: 'integer' },
                        isPublic: { type: 'boolean' }
                    }
                },
                CreateWordList: {
                    type: 'object',
                    required: ['name', 'words'],
                    properties: {
                        name: {
                            type: 'string',
                            minLength: 1,
                            maxLength: 100
                        },
                        description: {
                            type: 'string',
                            maxLength: 500
                        },
                        words: {
                            type: 'array',
                            items: { type: 'string', minLength: 1, maxLength: 50 },
                            minItems: 25,
                            description: 'At least 25 words required'
                        },
                        isPublic: {
                            type: 'boolean',
                            default: false
                        }
                    }
                },
                UpdateWordList: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', minLength: 1, maxLength: 100 },
                        description: { type: 'string', maxLength: 500 },
                        words: {
                            type: 'array',
                            items: { type: 'string' },
                            minItems: 25
                        },
                        isPublic: { type: 'boolean' }
                    }
                }
            },
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token for authenticated requests'
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
            },
            // Word List endpoints
            '/api/wordlists': {
                get: {
                    tags: ['Word Lists'],
                    summary: 'List public word lists',
                    description: 'Get a paginated list of public word lists. Supports search filtering.',
                    parameters: [
                        {
                            name: 'search',
                            in: 'query',
                            schema: { type: 'string', maxLength: 100 },
                            description: 'Search term to filter word lists by name'
                        },
                        {
                            name: 'limit',
                            in: 'query',
                            schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                            description: 'Maximum number of results to return'
                        },
                        {
                            name: 'offset',
                            in: 'query',
                            schema: { type: 'integer', minimum: 0, default: 0 },
                            description: 'Number of results to skip for pagination'
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Word lists retrieved',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            wordLists: {
                                                type: 'array',
                                                items: { $ref: '#/components/schemas/WordListSummary' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                },
                post: {
                    tags: ['Word Lists'],
                    summary: 'Create word list',
                    description: 'Create a new custom word list. Requires authentication.',
                    security: [{ bearerAuth: [] }],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/CreateWordList' }
                            }
                        }
                    },
                    responses: {
                        '201': {
                            description: 'Word list created',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            wordList: { $ref: '#/components/schemas/WordList' }
                                        }
                                    }
                                }
                            }
                        },
                        '400': {
                            description: 'Invalid input',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        },
                        '403': {
                            description: 'Authentication required',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        }
                    }
                }
            },
            '/api/wordlists/{id}': {
                get: {
                    tags: ['Word Lists'],
                    summary: 'Get word list by ID',
                    description: 'Get a specific word list with all words. Private lists require authentication.',
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                            description: 'Word list UUID'
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Word list retrieved',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            wordList: { $ref: '#/components/schemas/WordList' }
                                        }
                                    }
                                }
                            }
                        },
                        '403': {
                            description: 'Not authorized to view private word list',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        },
                        '404': {
                            description: 'Word list not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        }
                    }
                },
                put: {
                    tags: ['Word Lists'],
                    summary: 'Update word list',
                    description: 'Update an existing word list. Requires authentication and ownership.',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                            description: 'Word list UUID'
                        }
                    ],
                    requestBody: {
                        required: true,
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/UpdateWordList' }
                            }
                        }
                    },
                    responses: {
                        '200': {
                            description: 'Word list updated',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            wordList: { $ref: '#/components/schemas/WordList' }
                                        }
                                    }
                                }
                            }
                        },
                        '403': {
                            description: 'Not authorized',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        },
                        '404': {
                            description: 'Word list not found',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        }
                    }
                },
                delete: {
                    tags: ['Word Lists'],
                    summary: 'Delete word list',
                    description: 'Delete a word list. Requires authentication and ownership.',
                    security: [{ bearerAuth: [] }],
                    parameters: [
                        {
                            name: 'id',
                            in: 'path',
                            required: true,
                            schema: { type: 'string', format: 'uuid' },
                            description: 'Word list UUID'
                        }
                    ],
                    responses: {
                        '200': {
                            description: 'Word list deleted',
                            content: {
                                'application/json': {
                                    schema: {
                                        type: 'object',
                                        properties: {
                                            success: { type: 'boolean' }
                                        }
                                    }
                                }
                            }
                        },
                        '403': {
                            description: 'Not authorized',
                            content: {
                                'application/json': {
                                    schema: { $ref: '#/components/schemas/Error' }
                                }
                            }
                        },
                        '404': {
                            description: 'Word list not found',
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
    },
    apis: [] // We're defining everything in the definition above
};

const swaggerSpec = swaggerJsdoc(options);

/**
 * Setup Swagger UI middleware
 * @param {Express} app - Express application
 */
function setupSwagger(app) {
    // Serve Swagger UI at /api-docs
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Codenames API Documentation'
    }));

    // Serve raw OpenAPI spec at /api-docs.json
    app.get('/api-docs.json', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(swaggerSpec);
    });
}

module.exports = { setupSwagger, swaggerSpec };
