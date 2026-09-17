import { z } from 'zod';

/** Close codes shared with clients (documented in the README and shared/src/types.ts). */
export const CLOSE = {
  goingAway: 1001,
  replaced: 4002,
  protocolViolation: 4003,
  tooSlow: 4008,
} as const;

export const MAX_BAD_MESSAGES = 10;
export const MAX_TEXT_MESSAGE_BYTES = 1024;

const shortText = z.string().max(64);

export const deviceHelloSchema = z.object({
  type: z.literal('hello'),
  fw: shortText.optional(),
  bootId: shortText.optional(),
  ip: z.string().max(45).optional(),
});

export const deviceHeartbeatSchema = z.object({
  type: z.literal('heartbeat'),
  rssi: z.number().int().min(-127).max(0).optional(),
  uptimeS: z.number().int().min(0).optional(),
  freeHeap: z.number().int().min(0).optional(),
  streaming: z.boolean().optional(),
});

export const deviceCaptureResultSchema = z.object({
  type: z.literal('capture.result'),
  requestId: shortText,
  ok: z.boolean(),
  sampleId: z.number().int().positive().optional(),
  error: z.string().max(200).optional(),
});

export const viewerWatchSchema = z.object({
  type: z.literal('watch'),
  on: z.boolean(),
});

export type ParsedText =
  { kind: 'message'; type: string; value: Record<string, unknown> } | { kind: 'invalid' };

/** Parses a JSON text frame into an object with a string `type`, or reports it invalid. */
export function parseTextMessage(data: Buffer): ParsedText {
  if (data.length > MAX_TEXT_MESSAGE_BYTES) return { kind: 'invalid' };
  try {
    const value: unknown = JSON.parse(data.toString('utf8'));
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as { type?: unknown }).type === 'string'
    ) {
      return {
        kind: 'message',
        type: (value as { type: string }).type,
        value: value as Record<string, unknown>,
      };
    }
  } catch {
    // Falls through to invalid.
  }
  return { kind: 'invalid' };
}

export function isJpegFrame(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0xff && data[1] === 0xd8;
}
