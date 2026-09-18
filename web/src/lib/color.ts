/** Converts a `#rrggbb` color plus an alpha (0-1) into an `rgba(...)` string. */
export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return hex;
  const [, r, g, b] = match;
  const clamped = Math.min(1, Math.max(0, alpha));
  return `rgba(${parseInt(r ?? '0', 16)}, ${parseInt(g ?? '0', 16)}, ${parseInt(b ?? '0', 16)}, ${clamped.toFixed(2)})`;
}
