import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares a presented device key with the configured one in constant time. Both sides are
 * hashed first so the buffers always have equal length and the key length is not leaked.
 */
export function isValidDeviceKey(presented: string | string[] | undefined, expected: string) {
  if (typeof presented !== 'string') return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
