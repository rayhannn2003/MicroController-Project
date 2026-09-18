import { afterEach, describe, expect, it } from 'vitest';
import { RATE_LIMITS } from '../src/lib/rateLimits.js';
import { createTestContext, fixtureJpeg, uploadHeaders, type TestContext } from './helpers.js';

let ctx: TestContext | undefined;

afterEach(async () => {
  await ctx?.close();
  ctx = undefined;
});

describe('rate limiting (hardening on)', () => {
  it('returns the standard error shape with a Retry-After header once a public-read bucket is exhausted', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.publicRead.max; i++) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/samples' });
      expect(res.statusCode, `request ${String(i + 1)}`).toBe(200);
    }
    const res = await ctx.app.inject({ method: 'GET', url: '/api/samples' });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again shortly.' },
    });
    expect(res.headers['retry-after']).toBeDefined();
  }, 20_000);

  it('shares one public-read budget across the covered read endpoints for the same IP', async () => {
    ctx = await createTestContext({ hardening: true });
    // Split the same budget across three different endpoints; the count still runs out together.
    const third = Math.floor(RATE_LIMITS.publicRead.max / 3);
    for (let i = 0; i < third; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/samples' })).statusCode).toBe(200);
      expect((await ctx.app.inject({ method: 'GET', url: '/api/stats' })).statusCode).toBe(200);
      expect((await ctx.app.inject({ method: 'GET', url: '/api/explore' })).statusCode).toBe(200);
    }
    const usedUp = third * 3;
    const remaining = RATE_LIMITS.publicRead.max - usedUp;
    for (let i = 0; i < remaining; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/samples' })).statusCode).toBe(200);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/api/samples' })).statusCode).toBe(429);
  }, 20_000);

  it('gives separate IPs their own public-read budget', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.publicRead.max; i++) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/samples',
        remoteAddress: '10.0.0.1',
      });
      expect(res.statusCode).toBe(200);
    }
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/samples', remoteAddress: '10.0.0.1' }))
        .statusCode,
    ).toBe(429);
    // A different visitor is unaffected.
    expect(
      (await ctx.app.inject({ method: 'GET', url: '/api/samples', remoteAddress: '10.0.0.2' }))
        .statusCode,
    ).toBe(200);
  }, 20_000);

  it('exempts /api/health from rate limiting', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.publicRead.max + 20; i++) {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode, `request ${String(i + 1)}`).toBe(200);
    }
  }, 20_000);

  it('gives /api/export.csv its own, stricter budget separate from other public reads', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.export.max; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/export.csv' })).statusCode).toBe(
        200,
      );
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/api/export.csv' })).statusCode).toBe(429);
    // The public-read budget (a separate, much larger bucket) is untouched.
    expect((await ctx.app.inject({ method: 'GET', url: '/api/samples' })).statusCode).toBe(200);
  }, 20_000);

  it('limits POST /api/samples with a valid key by the key, not by IP', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.uploadByKey.max; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/samples?ok=0',
        headers: uploadHeaders(),
        remoteAddress: '10.0.0.1',
      });
      expect(res.statusCode, `request ${String(i + 1)}`).toBe(201);
    }
    const exceeded = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: uploadHeaders(),
      remoteAddress: '10.0.0.1',
    });
    expect(exceeded.statusCode).toBe(429);

    // The same key from a different IP shares the same, now-exhausted budget.
    const sameKeyOtherIp = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: uploadHeaders(),
      remoteAddress: '10.0.0.2',
    });
    expect(sameKeyOtherIp.statusCode).toBe(429);
  }, 20_000);

  it('limits failed-auth uploads by IP, separately from the valid-key budget', async () => {
    ctx = await createTestContext({ hardening: true });
    for (let i = 0; i < RATE_LIMITS.uploadFailedAuth.max; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/samples?ok=0',
        headers: { 'x-device-key': 'wrong-key' },
        remoteAddress: '10.0.0.9',
      });
      expect(res.statusCode, `request ${String(i + 1)}`).toBe(401);
    }
    const exceeded = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: { 'x-device-key': 'wrong-key' },
      remoteAddress: '10.0.0.9',
    });
    expect(exceeded.statusCode).toBe(429);

    // A valid key from the same IP has its own, untouched budget.
    const validKey = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: uploadHeaders(),
      remoteAddress: '10.0.0.9',
    });
    expect(validKey.statusCode).toBe(201);

    // A different IP guessing keys has its own, untouched failed-auth budget too.
    const otherIp = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: { 'x-device-key': 'also-wrong' },
      remoteAddress: '10.0.0.10',
    });
    expect(otherIp.statusCode).toBe(401);
  }, 20_000);

  it('does not rate limit uploads or reads when hardening is off (the default in every other test)', async () => {
    ctx = await createTestContext();
    for (let i = 0; i < RATE_LIMITS.publicRead.max + 5; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/samples' })).statusCode).toBe(200);
    }
  }, 20_000);
});

describe('body and photo size limits', () => {
  it('rejects an oversized body with 413 (the global 16 KB default applies before routing)', async () => {
    ctx = await createTestContext();
    // No other route in this API accepts a body (the upload route has its own, larger limit for
    // photos), so this exercises the app-level default the way it would apply to any future
    // route: the body is rejected while still being read, before Fastify even matches a route.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/does-not-exist',
      headers: { 'content-type': 'application/json' },
      payload: 'x'.repeat(20 * 1024),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it("does not apply the small global limit to the upload route's own photo-sized limit", async () => {
    ctx = await createTestContext();
    const oversizedPhoto = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(30 * 1024)]);
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: { ...uploadHeaders(), 'content-type': 'image/jpeg' },
      payload: oversizedPhoto,
    });
    // Rejected for exceeding MAX_PHOTO_BYTES (the test config's 20 KB), not the 16 KB global limit.
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('still accepts a photo up to MAX_PHOTO_BYTES on the upload route', async () => {
    ctx = await createTestContext({ hardening: true });
    const jpeg = await fixtureJpeg();
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/samples?ok=0',
      headers: { ...uploadHeaders(), 'content-type': 'image/jpeg' },
      payload: jpeg,
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('security headers', () => {
  it('sends helmet security headers, including the documented CSP', async () => {
    ctx = await createTestContext({ hardening: true });
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['strict-transport-security']).toBeUndefined();

    const csp = res.headers['content-security-policy'];
    expect(csp).toBeDefined();
    const directives = String(csp)
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    expect(directives).toContain("default-src 'self'");
    expect(directives).toContain("script-src 'self'");
    expect(directives).toContain("style-src 'self' 'unsafe-inline'");
    expect(directives).toContain("img-src 'self' blob: data:");
    expect(directives).toContain("connect-src 'self'");
    expect(directives).toContain("object-src 'none'");
    expect(directives).toContain("frame-ancestors 'none'");
    expect(directives.some((d) => d.startsWith('upgrade-insecure-requests'))).toBe(false);
  });

  it('sends the same headers when hardening is off (helmet is always on)', async () => {
    ctx = await createTestContext();
    const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('error handling', () => {
  it('never leaks stack traces or SQL text for an internal error', async () => {
    ctx = await createTestContext();
    await ctx.sql.unsafe(`
      CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'internal detail nobody should see'; END $$;
      CREATE TRIGGER boom BEFORE INSERT ON samples FOR EACH ROW EXECUTE FUNCTION boom();
    `);
    try {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/api/samples?ok=0',
        headers: uploadHeaders(),
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(res.body).not.toContain('internal detail');
      expect(res.body).not.toContain('plpgsql');
      expect(res.body).not.toContain('.ts:');
    } finally {
      await ctx.sql.unsafe('DROP TRIGGER boom ON samples; DROP FUNCTION boom();');
    }
  });
});
