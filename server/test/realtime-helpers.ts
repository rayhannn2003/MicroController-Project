import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { WebSocket, type RawData } from 'ws';
import { buildApp, type AppConfig } from '../src/app.js';
import { createSql, type Sql } from '../src/db/client.js';
import type { RealtimeConfig } from '../src/realtime/index.js';
import { testDatabaseUrl } from './database.js';
import { DEVICE_KEY, MAX_PHOTO_BYTES } from './helpers.js';

/** Short timings so realtime tests run in milliseconds instead of seconds. */
export const TEST_REALTIME: RealtimeConfig = {
  deviceTimeoutMs: 300,
  maxFrameBytes: 5_000,
  slowViewerBytes: 2_000,
  targetFps: 5,
  jpegQuality: 65,
  maxViewers: 3,
  maxMessageBytes: 20_000,
  tickMs: 25,
  pingIntervalMs: 10_000,
  slowCloseMs: 200,
  maxIncomingFps: 100,
  viewersStartDelayMs: 20,
  viewersStopDelayMs: 40,
  viewersThrottleMs: 20,
  statsLogIntervalMs: 60_000,
};

export interface TestClient {
  socket: WebSocket;
  /** Text messages received, parsed as JSON. */
  messages: Record<string, unknown>[];
  frames: Buffer[];
  closed: { code: number; reason: string } | null;
  send(value: unknown): void;
  sendBinary(data: Buffer): void;
  /** Waits for a message matching the predicate, or throws after `timeout`. */
  next<T extends Record<string, unknown>>(
    predicate: (message: Record<string, unknown>) => boolean,
    timeout?: number,
  ): Promise<T>;
  waitForClose(timeout?: number): Promise<{ code: number; reason: string }>;
  waitForFrames(count: number, timeout?: number): Promise<Buffer[]>;
  close(): void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until<T>(get: () => T | undefined, timeout: number, what: string): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = get();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(5);
  }
}

export function connect(url: string, options: { headers?: Record<string, string> } = {}) {
  const socket = new WebSocket(url, options.headers ? { headers: options.headers } : {});
  const client: TestClient = {
    socket,
    messages: [],
    frames: [],
    closed: null,
    send: (value) => {
      socket.send(JSON.stringify(value));
    },
    sendBinary: (data) => {
      socket.send(data, { binary: true });
    },
    next: async (predicate, timeout = 2000) =>
      until(() => client.messages.find(predicate), timeout, 'a matching message') as never,
    waitForClose: (timeout = 2000) => until(() => client.closed ?? undefined, timeout, 'close'),
    waitForFrames: (count, timeout = 2000) =>
      until(
        () => (client.frames.length >= count ? client.frames : undefined),
        timeout,
        `${count} frames`,
      ),
    close: () => {
      socket.close();
    },
  };

  socket.on('message', (data: RawData, isBinary: boolean) => {
    const buffer = Buffer.isBuffer(data) ? data : Buffer.concat(data as Buffer[]);
    if (isBinary) client.frames.push(buffer);
    else client.messages.push(JSON.parse(buffer.toString('utf8')) as Record<string, unknown>);
  });
  socket.on('close', (code, reason) => {
    client.closed = { code, reason: reason.toString('utf8') };
  });
  socket.on('error', () => undefined);
  return client;
}

export async function connectOpen(url: string, options?: { headers?: Record<string, string> }) {
  const client = connect(url, options);
  await new Promise<void>((resolve, reject) => {
    client.socket.once('open', resolve);
    client.socket.once('error', reject);
  });
  return client;
}

export interface RealtimeContext {
  app: FastifyInstance;
  sql: Sql;
  baseUrl: string;
  wsUrl: string;
  photoDir: string;
  logs: string[];
  device(options?: { key?: string; query?: boolean }): Promise<TestClient>;
  viewer(): Promise<TestClient>;
  track(client: TestClient): TestClient;
  close(): Promise<void>;
}

export type RealtimeContextOptions = Omit<Partial<AppConfig>, 'realtime'> & {
  realtime?: Partial<RealtimeConfig>;
};

export async function createRealtimeContext(
  overrides: RealtimeContextOptions = {},
): Promise<RealtimeContext> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'sylvan-rt-'));
  const photoDir = path.join(tempRoot, 'photos');
  const sql = createSql(testDatabaseUrl());
  const logs: string[] = [];
  const { realtime: realtimeOverrides, ...configOverrides } = overrides;

  const app = await buildApp({
    sql,
    logStream: {
      write(chunk: string) {
        logs.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    config: {
      deviceKey: DEVICE_KEY,
      photoDir,
      maxPhotoBytes: MAX_PHOTO_BYTES,
      servePhotos: false,
      trustProxy: ['127.0.0.1'],
      logLevel: 'warn',
      displayTimezone: 'UTC',
      publicBaseUrl: 'http://127.0.0.1',
      realtime: { ...TEST_REALTIME, ...realtimeOverrides },
      ...configOverrides,
    },
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (typeof address === 'string' || address === null) throw new Error('No server address');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  const clients: TestClient[] = [];

  return {
    app,
    sql,
    baseUrl,
    wsUrl,
    photoDir,
    logs,
    track(client) {
      clients.push(client);
      return client;
    },
    async device({ key = DEVICE_KEY, query = false } = {}) {
      const client = await connectOpen(
        query ? `${wsUrl}/ws/device?key=${encodeURIComponent(key)}` : `${wsUrl}/ws/device`,
        query ? undefined : { headers: { 'x-device-key': key } },
      );
      clients.push(client);
      return client;
    },
    async viewer() {
      const client = await connectOpen(`${wsUrl}/ws/live`);
      clients.push(client);
      return client;
    },
    async close() {
      for (const client of clients) client.socket.terminate();
      await app.close();
      await sql.end({ timeout: 5 });
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

/** A minimal valid JPEG frame of the requested size. */
export function frameOf(size: number, marker = 0): Buffer {
  const frame = Buffer.alloc(Math.max(size, 4), marker);
  frame[0] = 0xff;
  frame[1] = 0xd8;
  frame[frame.length - 2] = 0xff;
  frame[frame.length - 1] = 0xd9;
  return frame;
}
