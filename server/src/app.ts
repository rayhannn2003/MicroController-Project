import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Sql } from './db/client.js';
import { AppError, errorBody } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';
import { photoRoutes } from './routes/photos.js';
import { sampleRoutes } from './routes/samples.js';
import { createPhotoStorage } from './services/photoStorage.js';
import { createSamplesService } from './services/samples.js';

export type AppConfig = Pick<
  Config,
  'deviceKey' | 'photoDir' | 'maxPhotoBytes' | 'servePhotos' | 'trustProxy' | 'logLevel'
>;

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

  const storage = createPhotoStorage(config.photoDir);
  const samples = createSamplesService({
    sql,
    storage,
    onCleanupError: (error, key) => {
      app.log.error({ err: error, photoKey: key }, 'failed to remove orphan photo');
    },
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

  await app.register(healthRoutes, { sql });
  await app.register(sampleRoutes, {
    samples,
    deviceKey: config.deviceKey,
    maxPhotoBytes: config.maxPhotoBytes,
  });
  if (config.servePhotos) {
    await app.register(photoRoutes, { photoDir: storage.root });
  }

  return app;
}
