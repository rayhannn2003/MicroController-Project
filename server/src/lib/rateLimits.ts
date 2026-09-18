import { createHash } from 'node:crypto';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import { AppError } from './errors.js';

/**
 * Fixed rate-limit policy for the public API (see README "Rate limits"). These are security
 * defaults, not per-deployment tuning, so they are constants rather than environment variables.
 */
export const RATE_LIMITS = {
  /** GET /api/samples, /api/samples/:id, /neighbors, /api/stats, /api/explore, /api/device*. */
  publicRead: { max: 120, timeWindow: '1 minute' },
  /** GET /api/export.csv streams up to 50,000 rows, so it gets a stricter budget. */
  export: { max: 10, timeWindow: '5 minutes' },
  /** POST /api/samples with a valid device key, keyed by a hash of that key (never the IP: the
   *  rover is behind NAT and may share an IP with other devices on the same network). */
  uploadByKey: { max: 60, timeWindow: '1 minute' },
  /** POST /api/samples with a missing or wrong key, keyed by IP, to slow down key guessing. */
  uploadFailedAuth: { max: 20, timeWindow: '1 minute' },
  /** New /ws/live connections per IP, so a script cannot open hundreds of sockets. */
  viewerConnectionsPerMinute: 20,
} as const;

/** Never store or log the raw device key; only its hash is used as a rate-limit bucket key. */
export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Fastify plugin-level defaults: registered with `global: false` so nothing is limited unless a
 * route (or the manual upload preHandlers) asks for it, and an error shape matching Phase 1's
 * `{ error: { code, message } }` convention instead of the plugin's own default body.
 */
export const rateLimitPluginOptions: RateLimitPluginOptions = {
  global: false,
  // The plugin throws whatever this returns. Building a real AppError means the app's existing
  // error handler (app.ts) renders it with Phase 1's `{ error: { code, message } }` shape and the
  // right status code (429, or 403 if ever banned) without any extra handling.
  errorResponseBuilder: (_request, context) =>
    new AppError(
      context.statusCode,
      'RATE_LIMITED',
      'Too many requests. Please try again shortly.',
    ),
};

/** Route-level rate-limit config for a simple per-IP bucket (the default `keyGenerator`). */
export function perIpRateLimit(bucket: { max: number; timeWindow: string }) {
  return { rateLimit: bucket };
}
