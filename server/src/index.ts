import { buildApp } from './app.js';
import { ConfigError, loadConfig, loadEnvFiles } from './config.js';
import { createSql } from './db/client.js';

async function main() {
  loadEnvFiles();
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  const sql = createSql(config.databaseUrl);
  const app = await buildApp({ config: { ...config, hardening: true }, sql });
  app.addHook('onClose', async () => {
    await sql.end({ timeout: 5 });
  });

  // A bug in one request or WebSocket handler must not take the whole server down: on a shared
  // VPS that would repeatedly drop every other visitor's connection while Docker restarts it.
  // Individual handlers already catch their own errors (see realtime/deviceChannel.ts and
  // viewerChannel.ts); this is only the last-resort net for anything that slips through.
  process.on('uncaughtException', (error) => {
    app.log.error({ err: error }, 'uncaught exception (continuing)');
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandled promise rejection (continuing)');
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const force = setTimeout(() => {
      app.log.error('graceful shutdown timed out');
      process.exit(1);
    }, 10_000);
    force.unref();
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exit(1);
      },
    );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ port: config.port, host: config.host });
  app.log.info(
    {
      publicBaseUrl: config.publicBaseUrl,
      servePhotos: config.servePhotos,
      displayTimezone: config.displayTimezone,
      env: config.nodeEnv,
    },
    'sylvan server ready',
  );
}

main().catch((error: unknown) => {
  console.error('fatal startup error:', error instanceof Error ? error.message : error);
  process.exit(1);
});
