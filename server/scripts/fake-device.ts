/**
 * Stands in for the ESP32-CAM so the realtime channel can be checked by hand.
 * It connects to /ws/device, sends heartbeats, and streams generated JPEG frames while the
 * server reports viewers. It reconnects with backoff, like the firmware should.
 *
 *   npx tsx server/scripts/fake-device.ts [--url ws://127.0.0.1:3100] [--fps 5] [--once]
 */
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { loadConfig, loadEnvFiles } from '../src/config.js';
import { makeJpeg } from './make-fixture.js';

interface Options {
  url: string;
  fps: number;
  heartbeatS: number;
  once: boolean;
  quality: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    url: process.env.DEVICE_WS_URL ?? 'ws://127.0.0.1:3100',
    fps: 5,
    heartbeatS: 10,
    once: false,
    quality: 65,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--url' && value) options.url = value;
    else if (arg === '--fps' && value) options.fps = Number(value);
    else if (arg === '--heartbeat' && value) options.heartbeatS = Number(value);
    else if (arg === '--once') options.once = true;
  }
  return options;
}

const BOOT_ID = randomBytes(3).toString('hex');
const started = Date.now();

// A small set of frames, cycled to make movement visible in the browser.
const FRAME_COUNT = 12;
const frames: Buffer[] = Array.from({ length: FRAME_COUNT }, (_, index) =>
  makeJpeg(320, 240, index * 7),
);

function connect(options: Options, attempt: number, deviceKey: string) {
  const socket = new WebSocket(`${options.url}/ws/device`, {
    headers: { 'x-device-key': deviceKey },
  });

  let heartbeat: NodeJS.Timeout | null = null;
  let streamer: NodeJS.Timeout | null = null;
  let viewers = 0;
  let targetFps = options.fps;
  let sent = 0;
  let frameIndex = 0;
  let lastReport = Date.now();

  const stopStreaming = () => {
    if (streamer) clearInterval(streamer);
    streamer = null;
  };

  const startStreaming = () => {
    if (streamer) return;
    console.log(`[fake-device] streaming at ${targetFps} fps`);
    streamer = setInterval(
      () => {
        if (socket.readyState !== WebSocket.OPEN) return;
        // Skip a frame if the socket is already backed up, exactly as the firmware should.
        if (socket.bufferedAmount > 400_000) return;
        const frame = frames[frameIndex % FRAME_COUNT];
        frameIndex++;
        if (frame) {
          socket.send(frame);
          sent++;
        }
        const now = Date.now();
        if (now - lastReport >= 5000) {
          const fps = (sent / ((now - lastReport) / 1000)).toFixed(1);
          console.log(`[fake-device] sent ${sent} frames (${fps} fps), viewers=${viewers}`);
          sent = 0;
          lastReport = now;
        }
      },
      Math.max(20, Math.round(1000 / targetFps)),
    );
  };

  socket.on('open', () => {
    console.log(`[fake-device] connected to ${options.url} (bootId ${BOOT_ID})`);
    socket.send(JSON.stringify({ type: 'hello', fw: 'fake-device 1.0.0', bootId: BOOT_ID }));
    const sendHeartbeat = () => {
      socket.send(
        JSON.stringify({
          type: 'heartbeat',
          rssi: -55 - Math.floor(Math.random() * 20),
          uptimeS: Math.round((Date.now() - started) / 1000),
          freeHeap: 140_000 + Math.floor(Math.random() * 8000),
          streaming: streamer !== null,
        }),
      );
    };
    sendHeartbeat();
    heartbeat = setInterval(sendHeartbeat, options.heartbeatS * 1000);
  });

  socket.on('message', (data, isBinary) => {
    if (isBinary) return;
    const text = Buffer.isBuffer(data)
      ? data.toString('utf8')
      : Buffer.from(data as ArrayBuffer).toString('utf8');
    const message = JSON.parse(text) as {
      type: string;
      count?: number;
      targetFps?: number;
      jpegQuality?: number;
      requestId?: string;
    };
    if (message.type === 'viewers') {
      viewers = message.count ?? 0;
      console.log(`[fake-device] viewers=${viewers}`);
      if (viewers > 0) startStreaming();
      else stopStreaming();
    } else if (message.type === 'config') {
      targetFps = message.targetFps ?? targetFps;
      console.log(`[fake-device] config targetFps=${targetFps} quality=${message.jpegQuality}`);
      if (streamer) {
        stopStreaming();
        startStreaming();
      }
    } else if (message.type === 'capture') {
      // Phase 4 will actually take a photo here.
      socket.send(
        JSON.stringify({
          type: 'capture.result',
          requestId: message.requestId,
          ok: false,
          error: 'not implemented',
        }),
      );
    }
  });

  socket.on('close', (code, reason) => {
    if (heartbeat) clearInterval(heartbeat);
    stopStreaming();
    console.log(`[fake-device] closed (${code} ${reason.toString() || 'no reason'})`);
    if (options.once) process.exit(code === 1000 ? 0 : 1);
    const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
    console.log(`[fake-device] reconnecting in ${Math.round(delay)} ms`);
    setTimeout(() => {
      connect(options, attempt + 1, deviceKey);
    }, delay);
  });

  socket.on('error', (error) => {
    console.error(`[fake-device] error: ${error.message}`);
  });

  socket.on('unexpected-response', (_request, response) => {
    console.error(`[fake-device] handshake refused: HTTP ${response.statusCode}`);
    response.resume();
  });
}

loadEnvFiles();
const deviceKey = process.env.DEVICE_KEY ?? loadConfig().deviceKey;
const options = parseArgs(process.argv.slice(2));
connect(options, 0, deviceKey);
