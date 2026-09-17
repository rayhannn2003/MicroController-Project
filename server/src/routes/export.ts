import { Readable } from 'node:stream';
import type { FastifyPluginAsync } from 'fastify';
import { parseExportQuery } from '../lib/validation.js';
import type { ExportService } from '../services/export.js';

function localDate(tz: string, date = new Date()): string {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

export const exportRoutes: FastifyPluginAsync<{ exporter: ExportService }> = async (
  app,
  { exporter },
) => {
  app.get('/api/export.csv', async (request, reply) => {
    const { tz, rows } = await exporter.prepare(
      parseExportQuery(request.query as Record<string, unknown>),
    );

    let filenameDate: string;
    try {
      filenameDate = localDate(tz);
    } catch {
      // Postgres may know a zone that this Node build does not.
      filenameDate = localDate('UTC');
    }

    const stream = Readable.from(rows(), { objectMode: false });
    stream.on('error', (error) => {
      request.log.error({ err: error }, 'CSV export failed while streaming');
    });

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="sylvan-samples-${filenameDate}.csv"`)
      .header('cache-control', 'no-store')
      .header('x-content-type-options', 'nosniff')
      .send(stream);
  });
};
