import type { FastifyPluginAsync } from 'fastify';
import { parseStatsQuery } from '../lib/validation.js';
import type { StatsService } from '../services/stats.js';

export const statsRoutes: FastifyPluginAsync<{ stats: StatsService }> = async (app, { stats }) => {
  app.get('/api/stats', async (request) => {
    return stats.get(parseStatsQuery(request.query as Record<string, unknown>));
  });
};
