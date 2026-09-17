/**
 * Inserts about 60 realistic samples spread over the last 14 days.
 * Refuses to run unless SEED_CONFIRM=yes. Safe to re-run: existing seed rows are skipped.
 */
import { loadConfig, loadEnvFiles } from '../src/config.js';
import { createSql } from '../src/db/client.js';
import { createPhotoStorage, type StoredPhoto } from '../src/services/photoStorage.js';
import { makeJpeg } from './make-fixture.js';

const SAMPLE_COUNT = 60;
const FAILED_COUNT = 9; // 85% OK
const DAYS = 14;

// Small deterministic PRNG so every run produces the same data set.
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(17);
const between = (min: number, max: number) => min + random() * (max - min);
const round1 = (value: number) => Math.round(value * 10) / 10;

/** Plausible indoor-garden readings for a given UTC hour. */
function readings(hour: number) {
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  return {
    temperature: round1(between(20.5, 23) + daylight * between(3, 6)),
    humidity: round1(between(58, 72) - daylight * between(4, 12)),
    lux: Math.round(
      daylight > 0 ? between(300, 900) + daylight * between(2000, 9000) : between(5, 120),
    ),
  };
}

async function main() {
  if (process.env.SEED_CONFIRM !== 'yes') {
    console.error(
      'Refusing to seed: set SEED_CONFIRM=yes to insert demo samples into the database.',
    );
    process.exit(1);
  }

  loadEnvFiles();
  const config = loadConfig();
  const sql = createSql(config.databaseUrl, { max: 1 });
  const storage = createPhotoStorage(config.photoDir);

  const failed = new Set<number>();
  while (failed.size < FAILED_COUNT) failed.add(Math.floor(random() * SAMPLE_COUNT));

  const now = Date.now();
  let inserted = 0;
  let photos = 0;

  try {
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const uploadId = `seed-${String(i + 1).padStart(3, '0')}`;
      const createdAt = new Date(
        now - DAYS * 86_400_000 + ((i + random() * 0.8) / SAMPLE_COUNT) * DAYS * 86_400_000,
      );
      const ok = !failed.has(i);
      const values = ok ? readings(createdAt.getUTCHours()) : null;
      const withPhoto = random() < 0.65;

      const [existing] = await sql`SELECT 1 FROM samples WHERE upload_id = ${uploadId}`;
      if (existing) continue;

      let photo: StoredPhoto | null = null;
      if (withPhoto) photo = await storage.save(makeJpeg(160, 120, i), createdAt);

      try {
        await sql`
          INSERT INTO samples (created_at, upload_id, ok, temperature, humidity, lux, photo_key, photo_bytes)
          VALUES (${createdAt}, ${uploadId}, ${ok}, ${values?.temperature ?? null},
                  ${values?.humidity ?? null}, ${values?.lux ?? null},
                  ${photo?.key ?? null}, ${photo?.bytes ?? null})
        `;
      } catch (error) {
        if (photo) await storage.remove(photo.key);
        throw error;
      }
      inserted++;
      if (photo) photos++;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(
    `Seeded ${inserted} samples (${photos} with photos); ${SAMPLE_COUNT - inserted} already existed.`,
  );
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
