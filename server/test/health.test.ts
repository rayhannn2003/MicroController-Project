import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createSql } from '../src/db/client.js';
import { DEVICE_KEY, createTestContext } from './helpers.js';

describe('GET /api/health', () => {
  it('returns 200 when the database answers', async () => {
    const ctx = await createTestContext();
    try {
      const res = await ctx.app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        status: 'ok',
        db: 'ok',
        disk: { photoBytes: 0, photoCount: 0 },
      });
    } finally {
      await ctx.close();
    }
  });

  it('returns 503 when the database is unreachable', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'sylvan-health-'));
    // Nothing listens on port 1, so every connection attempt fails immediately.
    const sql = createSql('postgres://nobody:nothing@127.0.0.1:1/none');
    const app = await buildApp({
      sql,
      config: {
        deviceKey: DEVICE_KEY,
        photoDir: tempRoot,
        maxPhotoBytes: 10_000,
        servePhotos: false,
        trustProxy: ['127.0.0.1'],
        logLevel: 'silent',
      },
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is unreachable' },
      });
    } finally {
      await app.close();
      await sql.end({ timeout: 1 });
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('unknown routes', () => {
  it('use the standard error shape', async () => {
    const ctx = await createTestContext();
    try {
      const res = await ctx.app.inject({ method: 'GET', url: '/nope' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    } finally {
      await ctx.close();
    }
  });
});
