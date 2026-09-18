import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { hashDeviceKey, rateLimitPluginOptions } from '../src/lib/rateLimits.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal app exercising the exact plugin options the real routes use, with a short window
 *  so "resets after the window" can be tested with real time instead of mocking the library's
 *  internals. The full `{ error: { code, message } }` body shape (built from the AppError this
 *  throws) is covered against the real app's error handler in hardening.test.ts. */
async function tinyApp(max: number, timeWindowMs: number) {
  const app = Fastify();
  await app.register(rateLimit, {
    ...rateLimitPluginOptions,
    global: true,
    max,
    timeWindow: timeWindowMs,
  });
  app.get('/thing', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('rate limiting', () => {
  it('returns 429 with a Retry-After header once the limit is hit', async () => {
    const app = await tinyApp(2, 60_000);
    try {
      expect((await app.inject({ method: 'GET', url: '/thing' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/thing' })).statusCode).toBe(200);
      const res = await app.inject({ method: 'GET', url: '/thing' });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBeDefined();
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('tracks separate buckets per client IP', async () => {
    const app = await tinyApp(1, 60_000);
    try {
      expect(
        (await app.inject({ method: 'GET', url: '/thing', remoteAddress: '10.0.0.1' })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'GET', url: '/thing', remoteAddress: '10.0.0.1' })).statusCode,
      ).toBe(429);
      // A different IP has its own, unaffected budget.
      expect(
        (await app.inject({ method: 'GET', url: '/thing', remoteAddress: '10.0.0.2' })).statusCode,
      ).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('resets once the time window elapses', async () => {
    const app = await tinyApp(1, 150);
    try {
      expect((await app.inject({ method: 'GET', url: '/thing' })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/thing' })).statusCode).toBe(429);
      await sleep(200);
      expect((await app.inject({ method: 'GET', url: '/thing' })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  }, 10_000);

  it('hashes the device key so the raw key is never used as a bucket key', () => {
    const hash = hashDeviceKey('super-secret-device-key');
    expect(hash).not.toContain('super-secret-device-key');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic, so the same device always lands in the same bucket.
    expect(hashDeviceKey('super-secret-device-key')).toBe(hash);
    expect(hashDeviceKey('different-key')).not.toBe(hash);
  });
});
