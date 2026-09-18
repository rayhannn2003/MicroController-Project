import type { FastifyPluginAsync } from 'fastify';
import { parseExploreQuery } from '../lib/validation.js';
import type { ExploreService } from '../services/explore.js';

export const exploreRoutes: FastifyPluginAsync<{ explore: ExploreService }> = async (
  app,
  { explore },
) => {
  app.get('/api/explore', async (request) => {
    return explore.get(parseExploreQuery(request.query as Record<string, unknown>));
  });
};
