import type { NeighborsResponse } from '@sylvan/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext, insertSample, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;
const ids: Record<string, number> = {};

beforeAll(async () => {
  ctx = await createTestContext();
  await resetDatabase(ctx.sql);
  // Inserted out of time order, with two samples sharing a timestamp (ordered by id).
  ids.last = await insertSample(ctx.sql, { createdAt: '2026-09-03T00:00:00Z' });
  ids.first = await insertSample(ctx.sql, { createdAt: '2026-09-01T00:00:00Z' });
  ids.tieA = await insertSample(ctx.sql, { createdAt: '2026-09-02T00:00:00Z' });
  ids.tieB = await insertSample(ctx.sql, { createdAt: '2026-09-02T00:00:00Z' });
});
afterAll(() => ctx.close());

async function neighbors(id: number | string) {
  return ctx.app.inject({ method: 'GET', url: `/api/samples/${id}/neighbors` });
}

describe('GET /api/samples/:id/neighbors', () => {
  it('returns only a next id for the first sample', async () => {
    const res = await neighbors(ids.first ?? 0);
    expect(res.statusCode).toBe(200);
    expect(res.json<NeighborsResponse>()).toEqual({ previousId: null, nextId: ids.tieA });
  });

  it('returns both ids for middle samples, using id to break timestamp ties', async () => {
    expect((await neighbors(ids.tieA ?? 0)).json()).toEqual({
      previousId: ids.first,
      nextId: ids.tieB,
    });
    expect((await neighbors(ids.tieB ?? 0)).json()).toEqual({
      previousId: ids.tieA,
      nextId: ids.last,
    });
  });

  it('returns only a previous id for the last sample', async () => {
    expect((await neighbors(ids.last ?? 0)).json()).toEqual({
      previousId: ids.tieB,
      nextId: null,
    });
  });

  it.each(['999', 'abc', '0'])('returns 404 for %s', async (id) => {
    const res = await neighbors(id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Sample not found' } });
  });
});
