import type { HealthResponse } from '@sylvan/shared';
import type { FastifyPluginAsync } from 'fastify';
import { pingDatabase, type Sql } from '../db/client.js';
import { errorBody } from '../lib/errors.js';

export const healthRoutes: FastifyPluginAsync<{
  sql: Sql;
  realtimeHealth?: () => NonNullable<HealthResponse['ws']>;
}> = async (app, { sql, realtimeHealth }) => {
  app.get('/api/health', async (request, reply) => {
    if (await pingDatabase(sql)) {
      const body: HealthResponse = { status: 'ok', db: 'ok' };
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
