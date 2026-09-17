import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const PHOTO_KEY = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/;

export interface StoredPhoto {
  key: string;
  bytes: number;
}

export interface PhotoStorage {
  readonly root: string;
  save(data: Buffer, now?: Date): Promise<StoredPhoto>;
  remove(key: string): Promise<void>;
  resolve(key: string): string;
}

export function isJpeg(data: Buffer): boolean {
  return data.length >= 2 && data[0] === 0xff && data[1] === 0xd8;
}

export function createPhotoStorage(photoDir: string): PhotoStorage {
  const root = path.resolve(photoDir);

  function resolve(key: string): string {
    if (!PHOTO_KEY.test(key)) throw new Error('Invalid photo key');
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('Photo path escapes PHOTO_DIR');
    return target;
  }

  return {
    root,
    resolve,

    async save(data, now = new Date()) {
      const year = String(now.getUTCFullYear());
      const month = String(now.getUTCMonth() + 1).padStart(2, '0');
      const key = `${year}/${month}/${randomUUID()}.jpg`;
      const target = resolve(key);
      const dir = path.dirname(target);
      // Dot-prefixed temp name in the same directory so rename is atomic and it is never served.
      const temp = path.join(dir, `.${path.basename(target)}.${randomUUID()}.tmp`);

      await mkdir(dir, { recursive: true, mode: 0o755 });
      const handle = await open(temp, 'wx', 0o644);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } catch (error) {
        await handle.close();
        await rm(temp, { force: true });
        throw error;
      }
      await handle.close();

      try {
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return { key, bytes: data.length };
    },

    async remove(key) {
      await rm(resolve(key), { force: true });
    },
  };
}
