import type { HealthResponse } from '@sylvan/shared';
import type { FastifyPluginAsync } from 'fastify';
import { pingDatabase, type Sql } from '../db/client.js';
import { errorBody } from '../lib/errors.js';
import type { DiskUsageReporter } from '../services/diskUsage.js';

export const healthRoutes: FastifyPluginAsync<{
  sql: Sql;
  disk: DiskUsageReporter;
  realtimeHealth?: () => NonNullable<HealthResponse['ws']>;
}> = async (app, { sql, disk, realtimeHealth }) => {
  // Exempt from rate limiting: monitoring tools and the Docker healthcheck poll this often.
  // Harmless if @fastify/rate-limit is not registered at all (see app.ts, config.hardening).
  app.get('/api/health', { config: { rateLimit: false } }, async (request, reply) => {
    if (await pingDatabase(sql)) {
      const usage = disk.snapshot();
      const body: HealthResponse = {
        status: 'ok',
        db: 'ok',
        disk: { photoBytes: usage.bytes, photoCount: usage.count },
      };
      if (realtimeHealth) body.ws = realtimeHealth();
      return body;
    }
    request.log.warn('health check: database unreachable');
    return reply
      .code(503)
      .header('cache-control', 'no-store')
      .send(errorBody('DATABASE_UNAVAILABLE', 'Database is unreachable'));
  });
};
