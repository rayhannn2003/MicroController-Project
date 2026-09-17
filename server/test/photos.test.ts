import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPhotoStorage } from '../src/services/photoStorage.js';
import { createTestContext, fixtureJpeg, type TestContext } from './helpers.js';

const SECRET = 'top-secret-outside-photo-dir';

let ctx: TestContext;
let photoKey: string;
let jpeg: Buffer;

beforeAll(async () => {
  ctx = await createTestContext();
  jpeg = await fixtureJpeg();
  photoKey = (await createPhotoStorage(ctx.photoDir).save(jpeg)).key;
  await writeFile(path.join(ctx.tempRoot, 'secret.txt'), SECRET);
  await writeFile(path.join(ctx.photoDir, 'notes.txt'), SECRET);
  await mkdir(path.join(ctx.photoDir, '2026', '09'), { recursive: true });
  await writeFile(path.join(ctx.photoDir, '2026', '09', '.hidden.jpg.tmp'), jpeg);
});
afterAll(() => ctx.close());

describe('GET /photos/*', () => {
  it('serves a stored photo as an immutable JPEG', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/photos/${photoKey}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.rawPayload).toEqual(jpeg);
  });

  it.each([
    '/photos/../secret.txt',
    '/photos/..%2fsecret.txt',
    '/photos/%2e%2e/secret.txt',
    '/photos/%2e%2e%2fsecret.txt',
    '/photos/2026/09/..%2f..%2f..%2fsecret.txt',
    '/photos/....//secret.txt',
    '/photos/%252e%252e%252fsecret.txt',
    '/photos/notes.txt',
    '/photos/2026/09/.hidden.jpg.tmp',
    '/photos/',
    '/photos/2026/',
  ])('blocks %s', async (url) => {
    const res = await ctx.app.inject({ method: 'GET', url });
    expect([400, 403, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain(SECRET);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('is not registered when photo serving is disabled', async () => {
    const prod = await createTestContext({ servePhotos: false });
    try {
      const res = await prod.app.inject({ method: 'GET', url: '/photos/2026/09/x.jpg' });
      expect(res.statusCode).toBe(404);
    } finally {
      await prod.close();
    }
  });
});
