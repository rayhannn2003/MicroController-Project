import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db/client.js';
import { AppError, errorBody } from './lib/errors.js';
import { createRealtime, type Realtime, type RealtimeConfig } from './realtime/index.js';
import { deviceRoutes } from './routes/device.js';
import { healthRoutes } from './routes/health.js';
import { photoRoutes } from './routes/photos.js';
import { exportRoutes } from './routes/export.js';
import { sampleRoutes } from './routes/samples.js';
import { statsRoutes } from './routes/stats.js';
import { createDeviceEventStore } from './services/deviceEvents.js';
import { createEventBus, type EventBus } from './services/events.js';
import { createExportService } from './services/export.js';
import { createPhotoStorage } from './services/photoStorage.js';
import { createSamplesService } from './services/samples.js';
import { createStatsService } from './services/stats.js';
import { createTimezoneResolver } from './services/timezones.js';

export type AppConfig = Pick<
  Config,
  'deviceKey' | 'photoDir' | 'maxPhotoBytes' | 'servePhotos' | 'trustProxy' | 'logLevel'
> &
  Partial<Pick<Config, 'displayTimezone' | 'publicBaseUrl'>> & {
    /** Enables the WebSocket channels. Off unless set, so HTTP-only tests are unaffected. */
    realtime?: RealtimeConfig;
  };

declare module 'fastify' {
  interface FastifyInstance {
    events: EventBus;
    realtime: Realtime | null;
  }
}

export interface BuildAppOptions {
  config: AppConfig;
  sql: Sql;
  /** Destination for logs; tests pass a stream to inspect them. Defaults to stdout. */
  logStream?: NodeJS.WritableStream;
}

const FRAMEWORK_ERRORS: Record<string, { statusCode: number; code: string; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: {
    statusCode: 413,
    code: 'PAYLOAD_TOO_LARGE',
    message: 'Photo exceeds the maximum allowed size',
  },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    statusCode: 415,
    code: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Unsupported content type',
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {
    statusCode: 400,
    code: 'INVALID_CONTENT_LENGTH',
    message: 'Request body length does not match Content-Length',
  },
};

export async function buildApp({
  config,
  sql,
  logStream,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers["x-device-key"]', 'headers["x-device-key"]'],
        censor: '[redacted]',
      },
      ...(logStream ? { stream: logStream } : {}),
    },
    // Only honour X-Forwarded-* from the local reverse proxy.
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    return503OnClosing: true,
    requestIdHeader: false,
  });

  const events = createEventBus((error) => {
    app.log.error({ err: error }, 'event handler failed');
  });
  app.decorate('events', events);

  const storage = createPhotoStorage(config.photoDir);
  const samples = createSamplesService({
    sql,
    storage,
    onCleanupError: (error, key) => {
      app.log.error({ err: error, photoKey: key }, 'failed to remove orphan photo');
    },
  });

  const timezones = createTimezoneResolver(sql, config.displayTimezone ?? 'UTC');
  const stats = createStatsService({ sql, samples, timezones });
  const exporter = createExportService({
    sql,
    timezones,
    publicBaseUrl: config.publicBaseUrl ?? '',
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      if (error.statusCode >= 500) request.log.error({ err: error }, error.message);
      return reply.code(error.statusCode).send(errorBody(error.code, error.message));
    }

    const known = error.code ? FRAMEWORK_ERRORS[error.code] : undefined;
    if (known) {
      return reply.code(known.statusCode).send(errorBody(known.code, known.message));
    }

    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      return reply
        .code(status)
        .send(errorBody('BAD_REQUEST', 'The request could not be processed'));
    }

    request.log.error({ err: error }, 'unhandled error');
    return reply.code(500).send(errorBody('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send(errorBody('NOT_FOUND', 'Not found'));
  });

  let realtime: Realtime | null = null;
  if (config.realtime) {
    const deviceEvents = createDeviceEventStore({
      sql,
      onError: (error) => {
        app.log.error({ err: error }, 'could not record device event');
      },
      onDropped: (type) => {
        app.log.warn({ type }, 'device event rate limit reached; event not recorded');
      },
    });
    realtime = createRealtime({
      server: app.server,
      config: config.realtime,
      bus: events,
      events: deviceEvents,
      deviceKey: config.deviceKey,
      log: app.log,
    });
    await realtime.init();
    const active = realtime;
    // Close sockets before the HTTP server stops, or open connections would hold it open.
    app.addHook('preClose', async () => {
      await active.close();
    });
    await app.register(deviceRoutes, { getStatus: () => active.status(), events: deviceEvents });
  }
  app.decorate('realtime', realtime);

  const active = realtime;
  await app.register(healthRoutes, {
    sql,
    ...(active ? { realtimeHealth: () => active.health() } : {}),
  });
  await app.register(sampleRoutes, {
    samples,
    events,
    deviceKey: config.deviceKey,
    maxPhotoBytes: config.maxPhotoBytes,
  });
  await app.register(statsRoutes, { stats });
  await app.register(exportRoutes, { exporter });
  if (config.servePhotos) {
    await app.register(photoRoutes, { photoDir: storage.root });
  }

  return app;
}
