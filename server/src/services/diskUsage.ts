import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

export interface DiskUsage {
  bytes: number;
  count: number;
  oldest: Date | null;
  newest: Date | null;
}

/** Recursively sums the size of every `.jpg` file under `root`. A missing directory is empty. */
export async function scanPhotoDir(root: string): Promise<DiskUsage> {
  let bytes = 0;
  let count = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jpg')) {
        const info = await stat(full);
        bytes += info.size;
        count += 1;
        if (!oldest || info.mtime < oldest) oldest = info.mtime;
        if (!newest || info.mtime > newest) newest = info.mtime;
      }
    }
  }

  await walk(root);
  return { bytes, count, oldest, newest };
}

export interface DiskUsageReporter {
  snapshot(): { bytes: number; count: number };
  start(): void;
  stop(): void;
}

/**
 * Reports photo directory size on a timer rather than per request: `/api/health` is exempt from
 * rate limiting, so an unbounded filesystem walk on every call would itself be a DoS vector.
 */
export function createDiskUsageReporter(
  photoDir: string,
  options: { intervalMs?: number; onError?: (error: unknown) => void } = {},
): DiskUsageReporter {
  const intervalMs = options.intervalMs ?? 5 * 60_000;
  let current = { bytes: 0, count: 0 };
  let timer: NodeJS.Timeout | null = null;

  async function refresh() {
    try {
      const usage = await scanPhotoDir(photoDir);
      current = { bytes: usage.bytes, count: usage.count };
    } catch (error) {
      options.onError?.(error);
    }
  }

  return {
    snapshot: () => current,
    start() {
      void refresh();
      timer = setInterval(() => {
        void refresh();
      }, intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
