/** Generates the small JPEG test fixture used by tests and test-upload.sh. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';

export function makeJpeg(width = 64, height = 48, seed = 0): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 4 + seed * 37) % 256;
      data[i + 1] = (y * 5 + 90 + seed * 11) % 256;
      data[i + 2] = ((x + y) * 2 + 40) % 256;
      data[i + 3] = 255;
    }
  }
  return jpeg.encode({ data, width, height }, 80).data;
}

if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
  await mkdir(dir, { recursive: true });
  const image = makeJpeg();
  await writeFile(`${dir}sample.jpg`, image);
  console.log(`wrote test/fixtures/sample.jpg (${image.length} bytes)`);
}
