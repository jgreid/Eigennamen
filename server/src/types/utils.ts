/**
 * Utility Type Definitions
 *
 * Helper types, generics, and type utilities.
 */

// ============================================================================
// Generic Utility Types
// ============================================================================

/**
 * Make specific properties required
 */
export type RequireFields<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific properties optional
 */
export type OptionalFields<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Make all properties nullable
 */
export type Nullable<T> = { [P in keyof T]: T[P] | null };

/**
 * Deep partial - makes all nested properties optional
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Deep readonly - makes all nested properties readonly
 */
export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * Extract keys of type T that have values of type V
 */
export type KeysOfType<T, V> = { [K in keyof T]: T[K] extends V ? K : never }[keyof T];

/**
 * Omit properties that have never type
 */
export type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] };

// ============================================================================
// Async Utility Types
// ============================================================================

/**
 * Unwrap a Promise type
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * Make a function return a Promise
 */
export type AsyncFunction<T extends (...args: unknown[]) => unknown> =
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

/**
 * Generic async operation result
 */
export interface AsyncResult<T, E = Error> {
  success: boolean;
  data?: T;
  error?: E;
}

// ============================================================================
// Redis Utility Types
// ============================================================================

/**
 * Redis command result (string | null from GET)
 */
export type RedisGetResult = string | null;

/**
 * Redis hash result
 */
export type RedisHashResult = Record<string, string>;

/**
 * Redis set result (OK | null from SET with NX)
 */
export type RedisSetResult = 'OK' | null;

/**
 * Redis multi/exec result
 */
export type RedisMultiResult = Array<[error: Error | null, result: unknown]> | null;

// ============================================================================
// Logger Types
// ============================================================================

/**
 * Log levels
 */
export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';

/**
 * Logger interface
 */
export interface ILogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  http(message: string, meta?: Record<string, unknown>): void;
  verbose(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Generic API response structure
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Paginated response
 */
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// Timeout Utility Types
// ============================================================================

/**
 * Timeout configuration
 */
export interface TimeoutConfig {
  /** Timeout in milliseconds */
  REDIS_OPERATION: number;
  /** Timeout for database operations */
  DATABASE_OPERATION: number;
  /** Timeout for external API calls */
  EXTERNAL_API: number;
}

/**
 * Timeout error
 */
export interface TimeoutError extends Error {
  operation: string;
  timeoutMs: number;
}

// ============================================================================
// Validation Utility Types
// ============================================================================

/**
 * Validation result
 */
export interface ValidationResult<T = unknown> {
  success: boolean;
  data?: T;
  errors?: Array<{
    path: string;
    message: string;
  }>;
}

/**
 * Zod-like parse result
 */
export type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: Array<{ path: (string | number)[]; message: string }> } };

// ============================================================================
// Middleware Types
// ============================================================================

import type { Request, Response, NextFunction } from 'express';

/**
 * Express middleware function
 */
export type ExpressMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<void>;

/**
 * Express error handler
 */
export type ExpressErrorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => void;

/**
 * Extended Express request with custom properties
 */
export interface ExtendedRequest extends Request {
  /** Request ID for tracing */
  requestId?: string;
  /** Start time for timing */
  startTime?: number;
  /** Authenticated user info */
  user?: {
    id: string;
    sessionId: string;
  };
}

// ============================================================================
// Distributed Lock Types
// ============================================================================

/**
 * Lock acquisition result
 */
export interface LockResult {
  acquired: boolean;
  lockValue?: string;
  waitTime?: number;
}

/**
 * Lock options
 */
export interface LockOptions {
  /** Lock TTL in seconds */
  ttlSeconds: number;
  /** Maximum wait time in milliseconds */
  maxWaitMs?: number;
  /** Retry interval in milliseconds */
  retryIntervalMs?: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

/**
 * Server metrics
 */
export interface ServerMetrics {
  /** Uptime in seconds */
  uptime: number;
  /** Memory usage */
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
  };
  /** Active connections */
  connections: number;
  /** Active rooms */
  rooms: number;
  /** Total players */
  players: number;
  /** Games in progress */
  gamesInProgress: number;
  /** Request counts */
  requests: {
    total: number;
    errors: number;
  };
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Generic event handler
 */
export type EventHandler<T = unknown> = (data: T) => void | Promise<void>;

/**
 * Event emitter interface
 */
export interface IEventEmitter<Events extends Record<string, unknown>> {
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void;
  emit<K extends keyof Events>(event: K, data: Events[K]): void;
}
