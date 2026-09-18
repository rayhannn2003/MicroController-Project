/**
 * Prints how much disk photos are using: total files, total size, and the oldest/newest photo.
 * Read-only; never deletes anything (see SECURITY.md — disk usage is monitored, not managed).
 *
 *   npx tsx server/scripts/disk-report.ts
 */
import { loadConfig, loadEnvFiles } from '../src/config.js';
import { scanPhotoDir } from '../src/services/diskUsage.js';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function main() {
  loadEnvFiles();
  const config = loadConfig();
  const usage = await scanPhotoDir(config.photoDir);

  console.log(`Photo directory: ${config.photoDir}`);
  console.log(`Files:           ${usage.count.toLocaleString()}`);
  console.log(`Total size:      ${formatBytes(usage.bytes)}`);
  console.log(`Oldest photo:    ${usage.oldest?.toISOString() ?? 'n/a'}`);
  console.log(`Newest photo:    ${usage.newest?.toISOString() ?? 'n/a'}`);
  if (usage.count > 0) {
    console.log(`Average size:    ${formatBytes(usage.bytes / usage.count)}`);
  }
  // A rover sample photo is a small JPEG, typically 15-25 KB; that is the expected growth rate
  // per sample, so a fast-growing directory should ring a bell for an unexpectedly high sample
  // rate rather than a leak (this script never deletes anything).
  console.log('\nExpected growth: about 15-25 KB per sample the rover uploads with a photo.');
}

main().catch((error: unknown) => {
  console.error('disk-report failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
