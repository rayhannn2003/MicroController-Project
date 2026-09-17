import fastifyStatic from '@fastify/static';
import type { FastifyPluginAsync } from 'fastify';

// Only generated keys (YYYY/MM/<uuid>.jpg) are served; anything else is a 404.
const PHOTO_PATH = /^\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/;

/** Development-only photo serving; in production nginx serves PHOTO_DIR directly. */
export const photoRoutes: FastifyPluginAsync<{ photoDir: string }> = async (app, { photoDir }) => {
  await app.register(fastifyStatic, {
    root: photoDir,
    prefix: '/photos/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    serveDotFiles: false,
    wildcard: true,
    allowedPath: (pathName) => PHOTO_PATH.test(pathName),
    cacheControl: true,
    immutable: true,
    maxAge: '365d',
    lastModified: false,
    setHeaders: (res) => {
      res.header('content-type', 'image/jpeg');
      res.header('x-content-type-options', 'nosniff');
    },
  });
};
