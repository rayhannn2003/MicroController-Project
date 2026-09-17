import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { isValidDeviceKey } from '../lib/auth.js';
import { AppError, errorBody } from '../lib/errors.js';
import {
  parseListQuery,
  parseSampleId,
  parseUploadId,
  parseUploadQuery,
  type Readings,
} from '../lib/validation.js';
import { isJpeg } from '../services/photoStorage.js';
import type { SamplesService } from '../services/samples.js';

interface SampleRoutesOptions {
  samples: SamplesService;
  deviceKey: string;
  maxPhotoBytes: number;
}

interface ParsedUpload {
  readings: Readings | null;
  uploadId: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    sampleUpload: ParsedUpload | null;
  }
}

/** `POST /api/samples`, the fixed contract used by the ESP32-CAM firmware. */
const uploadRoute: FastifyPluginAsync<SampleRoutesOptions> = async (app, options) => {
  const { samples, deviceKey, maxPhotoBytes } = options;

  app.decorateRequest('sampleUpload', null);

  // Scoped to this plugin: the upload route accepts only raw JPEG bodies (or no body at all).
  app.removeAllContentTypeParsers();
  app.addContentTypeParser(
    'image/jpeg',
    { parseAs: 'buffer', bodyLimit: maxPhotoBytes },
    (_request, body, done) => {
      done(null, body);
    },
  );
  app.addContentTypeParser(
    '*',
    async (_request: FastifyRequest, payload: NodeJS.ReadableStream) => {
      for await (const chunk of payload) {
        if (chunk.length > 0) {
          throw new AppError(
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'Photo body must be sent as image/jpeg',
          );
        }
      }
      return undefined;
    },
  );

  // Auth, query validation and the idempotency lookup run before the body is read, so a
  // rejected or duplicate request never spends time or memory receiving a photo.
  const authenticate = async (request: FastifyRequest) => {
    if (!isValidDeviceKey(request.headers['x-device-key'], deviceKey)) {
      throw new AppError(401, 'UNAUTHORIZED', 'Missing or invalid device key');
    }
  };

  const validate = async (request: FastifyRequest) => {
    const { readings } = parseUploadQuery(request.query as Record<string, unknown>);
    const uploadId = parseUploadId(request.headers['x-upload-id']);
    request.sampleUpload = { readings, uploadId };
  };

  const replayDuplicate = async (request: FastifyRequest, reply: FastifyReply) => {
    const uploadId = request.sampleUpload?.uploadId;
    if (!uploadId) return;
    const existing = await samples.findUpload(uploadId);
    if (!existing) return;
    request.log.info(
      { uploadId, sampleId: existing.id },
      'duplicate upload id, returning existing',
    );
    return reply.code(200).send(existing);
  };

  app.post(
    '/api/samples',
    { bodyLimit: maxPhotoBytes, onRequest: [authenticate, validate, replayDuplicate] },
    async (request, reply) => {
      const upload = request.sampleUpload;
      if (!upload) throw new Error('Upload was not validated');

      const body = request.body;
      let photo: Buffer | null = null;
      if (Buffer.isBuffer(body) && body.length > 0) {
        if (!isJpeg(body)) {
          throw new AppError(
            400,
            'INVALID_PHOTO',
            'Photo body is not a JPEG (must start with FF D8)',
          );
        }
        photo = body;
      }

      const result = await samples.create({ ...upload, photo });
      request.log.info(
        { sampleId: result.response.id, created: result.created, photoBytes: photo?.length ?? 0 },
        result.created ? 'sample stored' : 'duplicate upload id resolved after race',
      );
      return reply.code(result.created ? 201 : 200).send(result.response);
    },
  );
};

const readRoutes: FastifyPluginAsync<{ samples: SamplesService }> = async (app, { samples }) => {
  app.get('/api/samples', async (request) => {
    return samples.list(parseListQuery(request.query as Record<string, unknown>));
  });

  app.get<{ Params: { id: string } }>('/api/samples/:id', async (request, reply) => {
    const id = parseSampleId(request.params.id);
    const sample = id === null ? null : await samples.get(id);
    if (!sample) return reply.code(404).send(errorBody('NOT_FOUND', 'Sample not found'));
    return sample;
  });

  app.get<{ Params: { id: string } }>('/api/samples/:id/neighbors', async (request, reply) => {
    const id = parseSampleId(request.params.id);
    const neighbors = id === null ? null : await samples.neighbors(id);
    if (!neighbors) return reply.code(404).send(errorBody('NOT_FOUND', 'Sample not found'));
    return neighbors;
  });
};

export const sampleRoutes: FastifyPluginAsync<SampleRoutesOptions> = async (app, options) => {
  await app.register(uploadRoute, options);
  await app.register(readRoutes, { samples: options.samples });
};
