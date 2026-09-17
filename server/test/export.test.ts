import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { csvCell } from '../src/lib/csv.js';
import { EXPORT_COLUMNS, EXPORT_MAX_ROWS } from '../src/services/export.js';
import { createTestContext, insertSample, resetDatabase, type TestContext } from './helpers.js';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx.close());
beforeEach(() => resetDatabase(ctx.sql));

async function exportCsv(query = '') {
  const res = await ctx.app.inject({ method: 'GET', url: `/api/export.csv${query}` });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  const lines = res.body.split('\r\n');
  expect(lines.pop()).toBe('');
  return { res, lines };
}

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    expect(csvCell('\rcmd')).toBe(`"'\rcmd"`);
  });

  it('keeps plain negative numbers in numeric columns only', () => {
    expect(csvCell('-5.5', { numeric: true })).toBe('-5.5');
    expect(csvCell(-12, { numeric: true })).toBe('-12');
    expect(csvCell('-5.5')).toBe("'-5.5");
    expect(csvCell('-1+1', { numeric: true })).toBe("'-1+1");
  });
});

describe('GET /api/export.csv', () => {
  it('sends a UTF-8 BOM, headers and an attachment filename', async () => {
    const { res, lines } = await exportCsv();
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="sylvan-samples-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(lines).toEqual([`\uFEFF${EXPORT_COLUMNS.join(',')}`]);
    expect(EXPORT_COLUMNS.join(',')).toBe(
      'id,created_at_utc,created_at_local,status,temperature_c,humidity_pct,light_lux,photo_url',
    );
  });

  it('writes rows newest first with UTC and local times', async () => {
    await insertSample(ctx.sql, {
      createdAt: '2026-09-10T20:00:00Z',
      temperature: -5,
      humidity: 40.5,
      lux: 12,
      photoKey: '2026/09/0b8c3f5e-6a55-4a3b-9d53-2f0b5b8a1c11.jpg',
    });
    await insertSample(ctx.sql, { createdAt: '2026-09-11T01:30:00Z', ok: false });

    const dhaka = await exportCsv();
    expect(dhaka.lines.slice(1)).toEqual([
      '2,2026-09-11T01:30:00Z,2026-09-11 07:30:00,failed,,,,',
      '1,2026-09-10T20:00:00Z,2026-09-11 02:00:00,ok,-5.0,40.5,12,' +
        'https://sylvan.example.com/photos/2026/09/0b8c3f5e-6a55-4a3b-9d53-2f0b5b8a1c11.jpg',
    ]);

    const utc = await exportCsv('?tz=UTC');
    expect(utc.lines[2]).toContain(',2026-09-10 20:00:00,');
  });

  it('applies status and date filters', async () => {
    await insertSample(ctx.sql, { createdAt: '2026-09-01T12:00:00Z' });
    await insertSample(ctx.sql, { createdAt: '2026-09-02T12:00:00Z', ok: false });
    await insertSample(ctx.sql, { createdAt: '2026-09-03T12:00:00Z' });
    await insertSample(ctx.sql, { createdAt: '2026-09-04T12:00:00Z' });

    const ids = async (query: string) =>
      (await exportCsv(query)).lines.slice(1).map((line) => line.split(',')[0]);

    expect(await ids('?status=ok')).toEqual(['4', '3', '1']);
    expect(await ids('?status=failed')).toEqual(['2']);
    expect(await ids('?from=2026-09-02&to=2026-09-03')).toEqual(['3', '2']);
    expect(await ids('?status=ok&from=2026-09-02')).toEqual(['4', '3']);
  });

  it('rejects invalid filters with a JSON error before streaming', async () => {
    for (const [query, code] of [
      ['?tz=Nowhere/City', 'INVALID_TIMEZONE'],
      ['?status=maybe', 'INVALID_STATUS'],
      ['?from=nope', 'INVALID_DATE'],
    ] as const) {
      const res = await ctx.app.inject({ method: 'GET', url: `/api/export.csv${query}` });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
    }
  });

  it('streams across batches and stops at the row cap with a comment line', async () => {
    const total = EXPORT_MAX_ROWS + 5;
    await ctx.sql`
      INSERT INTO samples (created_at, ok, temperature, humidity, lux)
      SELECT timestamptz '2026-01-01T00:00:00Z' + (n * interval '1 minute'), true, 21.5, 55, n % 65535
      FROM generate_series(1, ${total}) AS n
    `;

    const { lines } = await exportCsv();
    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(EXPORT_MAX_ROWS + 1);
    expect(dataLines.at(-1)).toMatch(/^# Export truncated at 50000 rows/);
    const ids = dataLines.slice(0, -1).map((line) => Number(line.split(',')[0]));
    expect(new Set(ids).size).toBe(EXPORT_MAX_ROWS);
    expect(ids[0]).toBe(total);
    expect(ids.at(-1)).toBe(6);
  }, 60_000);
});
