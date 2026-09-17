import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSamplesService } from '../src/services/samples.js';
import { createPhotoStorage } from '../src/services/photoStorage.js';
import {
  DEVICE_KEY,
  MAX_PHOTO_BYTES,
  createTestContext,
  fixtureJpeg,
  listFiles,
  resetDatabase,
  uploadHeaders,
  type TestContext,
} from './helpers.js';

const OK_QUERY = '?ok=1&t=30.0&h=66.0&l=235';

interface StoredRow {
  id: string;
  upload_id: string | null;
  ok: boolean;
  temperature: string | null;
  humidity: string | null;
  lux: number | null;
  photo_key: string | null;
  photo_bytes: number | null;
}

let ctx: TestContext;
let jpeg: Buffer;

beforeAll(async () => {
  ctx = await createTestContext();
  jpeg = await fixtureJpeg();
});
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetDatabase(ctx.sql);
  await rm(ctx.photoDir, { recursive: true, force: true });
});

const rows = () => ctx.sql<StoredRow[]>`SELECT * FROM samples ORDER BY id`;

function upload(options: {
  query?: string;
  body?: Buffer | string;
  headers?: Record<string, string>;
  contentType?: string | null;
}) {
  const headers: Record<string, string> = { ...uploadHeaders(), ...options.headers };
  const contentType = options.contentType === undefined ? 'image/jpeg' : options.contentType;
  if (options.body !== undefined && contentType !== null) headers['content-type'] = contentType;
  return ctx.app.inject({
    method: 'POST',
    url: `/api/samples${options.query ?? OK_QUERY}`,
    headers,
    ...(options.body !== undefined ? { payload: options.body } : {}),
  });
}

describe('POST /api/samples — success', () => {
  it('stores a sample with a photo', async () => {
    const res = await upload({ body: jpeg });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: number; photo: boolean }>();
    expect(body).toEqual({ id: 1, photo: true });

    const [row] = await rows();
    expect(row).toMatchObject({
      ok: true,
      temperature: '30.0',
      humidity: '66.0',
      lux: 235,
      photo_bytes: jpeg.length,
    });
    expect(row?.photo_key).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    const file = path.join(ctx.photoDir, row?.photo_key ?? '');
    expect(await readFile(file)).toEqual(jpeg);
    expect(await listFiles(ctx.photoDir)).toEqual([row?.photo_key]);
  });

  it('stores a sample without a photo', async () => {
    const res = await upload({});
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 1, photo: false });
    const [row] = await rows();
    expect(row?.photo_key).toBeNull();
  });

  it('treats an empty image/jpeg body as no photo', async () => {
    const res = await upload({ body: Buffer.alloc(0) });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 1, photo: false });
  });

  it('stores a failed reading (ok=0) without readings', async () => {
    const res = await upload({ query: '?ok=0' });
    expect(res.statusCode).toBe(201);
    const [row] = await rows();
    expect(row).toMatchObject({ ok: false, temperature: null, humidity: null, lux: null });
  });

  it('accepts ok=0 with a photo', async () => {
    const res = await upload({ query: '?ok=0', body: jpeg });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 1, photo: true });
  });

  it('accepts boundary values and rounds to one decimal', async () => {
    expect((await upload({ query: '?ok=1&t=-40&h=0&l=0' })).statusCode).toBe(201);
    expect((await upload({ query: '?ok=1&t=80&h=100&l=65535' })).statusCode).toBe(201);
    expect((await upload({ query: '?ok=1&t=21.26&h=50.04&l=10' })).statusCode).toBe(201);
    const stored = await rows();
    expect(stored[2]).toMatchObject({ temperature: '21.3', humidity: '50.0' });
  });
});

describe('POST /api/samples — authentication', () => {
  it('rejects a missing device key', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: `/api/samples${OK_QUERY}` });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid device key' },
    });
  });

  it('rejects a wrong device key, before reading or storing the photo', async () => {
    const res = await upload({ body: jpeg, headers: { 'x-device-key': `${DEVICE_KEY}x` } });
    expect(res.statusCode).toBe(401);
    expect(await rows()).toHaveLength(0);
    expect(await listFiles(ctx.photoDir)).toEqual([]);
  });

  it('checks auth before the body size limit', async () => {
    const res = await upload({
      body: Buffer.alloc(MAX_PHOTO_BYTES + 10, 0xff),
      headers: { 'x-device-key': 'wrong' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('never writes the device key to the logs', async () => {
    ctx.logs.length = 0;
    await upload({ body: jpeg });
    await upload({ headers: { 'x-device-key': 'wrong-key-attempt' } });
    const output = ctx.logs.join('');
    expect(output.length).toBeGreaterThan(0);
    expect(output).not.toContain(DEVICE_KEY);
    expect(output).not.toContain('wrong-key-attempt');
  });
});

describe('POST /api/samples — query validation', () => {
  const cases: [string, string, string][] = [
    ['missing ok', '?t=30&h=60&l=10', 'INVALID_OK'],
    ['ok=2', '?ok=2&t=30&h=60&l=10', 'INVALID_OK'],
    ['ok=true', '?ok=true', 'INVALID_OK'],
    ['ok=0 with t', '?ok=0&t=30', 'READINGS_NOT_ALLOWED'],
    ['ok=0 with h', '?ok=0&h=60', 'READINGS_NOT_ALLOWED'],
    ['ok=0 with l', '?ok=0&l=10', 'READINGS_NOT_ALLOWED'],
    ['ok=0 with all readings', '?ok=0&t=30&h=60&l=10', 'READINGS_NOT_ALLOWED'],
    ['temperature below range', '?ok=1&t=-40.1&h=60&l=10', 'INVALID_TEMPERATURE'],
    ['temperature above range', '?ok=1&t=80.1&h=60&l=10', 'INVALID_TEMPERATURE'],
    ['temperature not a number', '?ok=1&t=hot&h=60&l=10', 'INVALID_TEMPERATURE'],
    ['temperature missing', '?ok=1&h=60&l=10', 'INVALID_TEMPERATURE'],
    ['temperature repeated', '?ok=1&t=20&t=21&h=60&l=10', 'INVALID_TEMPERATURE'],
    ['humidity below range', '?ok=1&t=20&h=-0.1&l=10', 'INVALID_HUMIDITY'],
    ['humidity above range', '?ok=1&t=20&h=100.1&l=10', 'INVALID_HUMIDITY'],
    ['humidity missing', '?ok=1&t=20&l=10', 'INVALID_HUMIDITY'],
    ['lux negative', '?ok=1&t=20&h=60&l=-1', 'INVALID_LUX'],
    ['lux above range', '?ok=1&t=20&h=60&l=65536', 'INVALID_LUX'],
    ['lux not an integer', '?ok=1&t=20&h=60&l=12.5', 'INVALID_LUX'],
    ['lux missing', '?ok=1&t=20&h=60', 'INVALID_LUX'],
  ];

  it.each(cases)('%s → 400 %s', async (_name, query, code) => {
    const res = await upload({ query });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string; message: string } }>().error.code).toBe(code);
    expect(await rows()).toHaveLength(0);
  });

  it('rejects a malformed X-Upload-Id', async () => {
    for (const id of ['', 'has space', 'a'.repeat(65), 'semi;colon']) {
      const res = await upload({ headers: { 'x-upload-id': id } });
      expect(res.statusCode, `upload id ${JSON.stringify(id)}`).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_UPLOAD_ID');
    }
  });
});

describe('POST /api/samples — photo body', () => {
  it('rejects a non-JPEG body', async () => {
    const res = await upload({ body: Buffer.from('not a jpeg at all') });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('INVALID_PHOTO');
    expect(await rows()).toHaveLength(0);
    expect(await listFiles(ctx.photoDir)).toEqual([]);
  });

  it('rejects an oversized body', async () => {
    const big = Buffer.concat([jpeg, Buffer.alloc(MAX_PHOTO_BYTES)]);
    const res = await upload({ body: big });
    expect(res.statusCode).toBe(413);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await rows()).toHaveLength(0);
  });

  it('accepts a photo of exactly MAX_PHOTO_BYTES', async () => {
    const exact = Buffer.concat([jpeg, Buffer.alloc(MAX_PHOTO_BYTES - jpeg.length)]);
    expect((await upload({ body: exact })).statusCode).toBe(201);
  });

  it('rejects other content types that carry a body', async () => {
    for (const contentType of ['image/png', 'application/json', 'text/plain']) {
      const res = await upload({ body: '{"a":1}', contentType });
      expect(res.statusCode, contentType).toBe(415);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    }
    expect(await rows()).toHaveLength(0);
  });

  it('rejects a body without a content type', async () => {
    const res = await upload({ body: jpeg, contentType: null });
    expect(res.statusCode).toBe(415);
  });

  it('accepts an empty body with another content type', async () => {
    const res = await upload({ body: '', contentType: 'application/octet-stream' });
    expect(res.statusCode).toBe(201);
  });
});

describe('POST /api/samples — idempotency', () => {
  it('returns the existing sample for a repeated X-Upload-Id', async () => {
    const headers = { 'x-upload-id': 'a1b2c3d4-17' };
    const first = await upload({ body: jpeg, headers });
    const second = await upload({ body: jpeg, headers });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(await rows()).toHaveLength(1);
    expect(await listFiles(ctx.photoDir)).toHaveLength(1);
  });

  it('stores two samples with different upload ids', async () => {
    await upload({ headers: { 'x-upload-id': 'esp-1' } });
    const res = await upload({ headers: { 'x-upload-id': 'esp-2' } });
    expect(res.statusCode).toBe(201);
    expect(await rows()).toHaveLength(2);
  });

  it('handles concurrent requests with the same X-Upload-Id', async () => {
    const headers = { 'x-upload-id': 'race-1' };
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => upload({ body: jpeg, headers })),
    );

    expect(responses.map((res) => res.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(responses.map((res) => res.json<{ id: number }>().id));
    expect(ids.size).toBe(1);

    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(await listFiles(ctx.photoDir)).toEqual([stored[0]?.photo_key]);
  });

  it('cleans up the losing photo when two inserts race past the duplicate check', async () => {
    // Call the service directly so both requests skip the early lookup and hit the insert.
    const storage = createPhotoStorage(ctx.photoDir);
    const service = createSamplesService({ sql: ctx.sql, storage });
    const input = {
      readings: { temperature: 20, humidity: 50, lux: 100 },
      uploadId: 'race-2',
      photo: jpeg,
    };

    const results = await Promise.all([service.create(input), service.create(input)]);

    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(results[0].response).toEqual(results[1].response);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(await listFiles(ctx.photoDir)).toEqual([stored[0]?.photo_key]);
  });
});

describe('POST /api/samples — database failure', () => {
  it('removes the photo when the insert fails and hides the SQL error', async () => {
    await ctx.sql.unsafe(`
      CREATE FUNCTION fail_sample_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated database failure'; END $$;
      CREATE TRIGGER fail_sample_insert BEFORE INSERT ON samples
        FOR EACH ROW EXECUTE FUNCTION fail_sample_insert();
    `);
    try {
      const res = await upload({ body: jpeg });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      expect(res.body).not.toContain('simulated');
      expect(await listFiles(ctx.photoDir)).toEqual([]);
    } finally {
      await ctx.sql.unsafe(`
        DROP TRIGGER fail_sample_insert ON samples;
        DROP FUNCTION fail_sample_insert();
      `);
    }
  });
});

describe('photo storage', () => {
  it('refuses keys that could escape PHOTO_DIR', async () => {
    const storage = createPhotoStorage(ctx.photoDir);
    for (const key of ['../evil.jpg', '2026/09/../../../etc/passwd', '/etc/passwd']) {
      expect(() => storage.resolve(key)).toThrow();
      await expect(storage.remove(key)).rejects.toThrow();
    }
    expect(existsSync(path.join(ctx.tempRoot, 'evil.jpg'))).toBe(false);
  });
});
