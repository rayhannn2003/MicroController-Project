import type { DeviceEventsResponse, DeviceStatus } from '@sylvan/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../lib/errors.js';
import type { DeviceEventStore } from '../services/deviceEvents.js';

/**
 * Public, read-only device endpoints. `GET /api/device` lets pages show status when WebSockets
 * are blocked. The event log is public too: it holds only times, event types, signal, uptime,
 * firmware, boot id and close codes, all of which the live status already exposes. No IP
 * addresses or keys are stored.
 */
export const deviceRoutes: FastifyPluginAsync<{
  getStatus: () => DeviceStatus;
  events: DeviceEventStore;
}> = async (app, { getStatus, events }) => {
  app.get('/api/device', async (_request, reply) => {
    void reply.header('cache-control', 'no-store');
    return getStatus();
  });

  app.get('/api/device/events', async (request) => {
    const { limit: raw } = request.query as { limit?: unknown };
    let limit = 20;
    if (raw !== undefined) {
      if (
        typeof raw !== 'string' ||
        !/^\d{1,3}$/.test(raw) ||
        Number(raw) < 1 ||
        Number(raw) > 100
      ) {
        throw new AppError(400, 'INVALID_LIMIT', 'limit must be a whole number between 1 and 100');
      }
      limit = Number(raw);
    }
    return { items: await events.recent(limit) } satisfies DeviceEventsResponse;
  });
};
