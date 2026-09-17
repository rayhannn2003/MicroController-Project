# Project Sylvan

An ATmega32A line-following rover that stops beside an object, records temperature,
humidity and light, shows the result on an OLED, then continues along the line.
The firmware runs at **1 MHz** and is built from `car/`.
The web platform that receives the ESP32-CAM uploads is described in
[Web platform](#web-platform).

## Current progress

- The working line follower in [`car/lfr.c`](car/lfr.c) is preserved unchanged.
  Its motor control, sensor polarity and recovery decisions were extracted into
  modules. An automated comparison matched the original motor outputs for
  320,448 line-sensor updates.
- The OLED, DHT11, BH1750 and HC-SR04 drivers are integrated. The latest user
  report says the current setup is working. A separate OLED test displays
  `HELLO` when isolating the screen from the rover code.
- **Stage 6 is the default build.** Its timed sampling cycle is implemented and
  covered by host tests and AVR simulation. The full set of track and sensor
  failure checks has not yet been recorded on the physical rover.
- The two working references, [`car/lfr.c`](car/lfr.c) and
  [`car/lightTemSr.c`](car/lightTemSr.c), remain available for comparison.

## What the rover does

1. Follow the black line. The OLED shows `Object detection`, `No object` and
   `Car is moving`. Each line sensor reads **HIGH on black** and **LOW on floor**.
2. When the left-front HC-SR04 measures an object at **30 cm or less**, stop and
   show `Object Detected` with fresh temperature, light and humidity readings.
3. Keep the readings on screen for **2 seconds**.
4. Show `Sample detected` / `successfully` for **2 seconds**, then resume the
   saved line-following state. If a reading fails, show `Sample failed` /
   `Check sensors` instead, then resume. One UART packet with the result is sent
   to the ESP32-CAM when acquisition finishes, while the motors are stopped.
5. Continue past that object. Detection rearms after **500 ms** of clear space
   (no echo or a reading above **35 cm**) so the same object does not cause
   repeated stops.

The original line decisions remain in use. Ultrasonic measurements briefly stop
the motors while travelling; sampling intentionally stops them for longer. This
can affect physical movement compared with running `lfr.c` alone.

## Wiring

| Device | ATmega32A pins |
| --- | --- |
| L298N IN1–IN4 | PB0–PB3 |
| L298N ENA, ENB | PD5/OC1A, PD4/OC1B |
| Left and right line sensors | PA1, PA2 |
| HC-SR04 TRIG, ECHO | PA0, PA4 |
| DHT11 DATA | PA3 |
| OLED and BH1750 SCL, SDA | PC0, PC1 |
| ESP32-CAM RX (GPIO14) | PD1/TXD via 1kΩ/2kΩ divider |

OLED address: **0x3C**. BH1750 address: **0x23**. Keep a common ground, the I2C
pull-ups and the ATmega32A AVCC/GND connections. `F_CPU=1000000UL` assumes the
MCU is actually running at 1 MHz; the build does not change fuse bits.

### ESP32-CAM data link

The ATmega only transmits (PD1/TXD; PD0/RXD is unused). The link is **9600 baud,
8N1**, using the USART double-speed mode (`U2X`, `UBRR=12`, 0.2% error at 1 MHz).
Normal mode would be about 7% off. Each sampling stop sends exactly one line:

```text
<S,T=30,H=66,L=235>\n    success: temperature °C, humidity %, light lux (integers)
<F>\n                    any sensor read failed or timed out
```

Lines end with `\n` only. Nothing is sent while following the line. If the
internal RC oscillator drifts too far, set `UART_BAUD` to `4800UL` in
`car/config.h` (and on the ESP32); the build rejects rates with more than 2% error.

## Build and flash

Run commands from the repository root:

```bash
cd car
make clean
make
make flash
```

`make flash` programs and verifies the default **Stage 6** rover image using
USBasp. `make clean` is needed only when you want to remove generated files.

For the simple OLED test, use:

```bash
make oled-debug-flash
```

That image displays `HELLO` and contains no motor or sensor code. Run
`make flash` afterward to return to the full rover program. To build the original
modular line follower alone, use `make STAGE=1` and `make STAGE=1 flash`.

## Code and checks

| Files | Purpose |
| --- | --- |
| `car/main.c`, `car/sample_cycle.c` | Main loop and timed object-sampling cycle |
| `car/line_follow.c`, `car/motor.c`, `car/line_sensor.c` | Logic and settings extracted from `lfr.c` |
| `car/hcsr04.c`, `car/dht11.c`, `car/bh1750.c` | Sensor drivers |
| `car/oled.c`, `car/twi.c` | OLED and shared I2C bus |
| `car/uart.c` | Transmit-only ESP32-CAM packets (Stage 6) |
| `car/timebase.c`, `car/config.h` | Scheduler clock and hardware configuration |
| `car/oled_debug.c` | Isolated OLED check |

`make test` runs line-output comparisons and sampling/display/UART packet tests. `make stages`
builds all six incremental stages. `make test-sim` runs the optional simavr
checks when its development files are installed.

See [`car/INTEGRATION.md`](car/INTEGRATION.md) for the timer-conflict report,
full build stages and hardware checklist. [`car/SOURCE_BUNDLE.md`](car/SOURCE_BUNDLE.md)
contains the complete modular source listings.

---

# Web platform

The ESP32-CAM sends each sampling result and a JPEG photo to a self-hosted server. The platform is
being built in five phases:

1. **Backend foundation** (done): project structure, PostgreSQL, upload API, photo storage and
   local Docker setup
2. **Dashboard** (done): stats and CSV endpoints, React frontend
3. Realtime WebSockets: device heartbeat, live camera stream, instant updates
4. Explore analytics, admin area, security hardening
5. Production deployment on the VPS

## What Phase 1 includes

- A Fastify + TypeScript API (`server/`) with a fixed upload contract for the ESP32
- PostgreSQL 17 with a small numbered-SQL migration runner (`schema_migrations`)
- Photo storage on disk (`YYYY/MM/<uuid>.jpg`) with atomic writes and cleanup when an upload fails
- Idempotent uploads through `X-Upload-Id`, including two identical requests arriving at once
- Public read API with keyset pagination and filters
- Shared API types (`shared/`) for the Phase 2 frontend
- Docker Compose for local development. The app listens on `127.0.0.1:3100` only, the database
  publishes no port, and both containers have memory limits.
- Vitest suite (86 tests) against a real PostgreSQL test database, plus ESLint, Prettier and strict
  TypeScript

## What Phase 2 includes

- **API additions:** `GET /api/stats` (totals, min/avg/max, previous-period comparison, zero-filled
  daily buckets in a timezone), `GET /api/samples/:id/neighbors`, a streamed `GET /api/export.csv`,
  and `hasPhoto` / `order` filters on `GET /api/samples`. The ESP32 upload contract is unchanged.
- **Dashboard (`web/`):** Vite + React 19 + TypeScript, React Router, TanStack Query, Tailwind CSS
  v4 and Recharts (lazy-loaded). Pages:
  - **Overview:** KPI cards with previous-period changes, latest sample, readings charts with
    gap breaks, samples per day, recent samples
  - **Gallery:** infinite scroll and an accessible lightbox with keyboard and swipe navigation
  - **Data:** sortable table (cards on phones), jump to ID, CSV export
  - **Sample detail:** comparison with the range average, previous/next navigation
- Filters live in the URL. Stats and the newest sample are polled every 15 s while the tab is
  visible, and a toast announces new uploads.
- Light and dark themes, mobile-first layout, WCAG 2.2 AA checks (axe) on every page, and a text
  summary plus table view for every chart.

## Local setup

**Prerequisites:** Node.js 22.13+, npm 10+, Docker with Compose v2, `openssl`, `curl`.

```bash
npm install

# 1. Configuration: copy the example and replace every secret.
cp .env.example .env
openssl rand -hex 32   # paste as DEVICE_KEY (the same value goes in the ESP32 firmware)
openssl rand -hex 16   # paste as DB_PASSWORD and inside DATABASE_URL
chmod 600 .env

# 2. Photo folder owned by you (the container runs as uid 1000).
mkdir -p data/photos

# 3. Start PostgreSQL + the API. The app applies migrations when it starts.
docker compose up -d --build
docker compose ps                     # both services should become "healthy"
curl http://127.0.0.1:3100/api/health

# 4. Optional demo data (60 samples over the last 14 days, some with photos)
npm run db:up                         # publishes the database on 127.0.0.1:5433 for host tools
SEED_CONFIRM=yes npm run db:seed
```

`npm run db:migrate` applies migrations by hand. It is safe to run repeatedly.

### Host-side development (no image rebuilds)

`npm run dev`, `npm test`, `npm run db:migrate` and `npm run db:seed` run on your machine. They
reach the Compose database through the opt-in `docker-compose.db-port.yml` override, which
publishes it on `127.0.0.1:5433`. Create `.env.local` (git-ignored). It is read before `.env` and
holds the host-side values:

```bash
HOST=127.0.0.1
DATABASE_URL=postgres://sylvan:<DB_PASSWORD>@127.0.0.1:5433/sylvan
PHOTO_DIR=./data/photos
```

```bash
npm run db:up        # database only, with 127.0.0.1:5433 published
npm run dev          # server (tsx watch, :3100) and dashboard (Vite, :5173) together
npm run dev:server   # server only (stop the app container first)
npm run dev:web      # dashboard only, proxying /api and /photos to the app on 127.0.0.1:3100
```

To work on the dashboard alone, keep the Compose app container running and use `npm run dev:web`,
then open http://127.0.0.1:5173. The dashboard only uses relative paths (`/api/...`, `/photos/...`),
so the same build works behind nginx in production. `npm run build` writes it to `web/dist`.

Real environment variables always win over both files. Inside Compose, `HOST`, `PORT`, `PHOTO_DIR`
and `DATABASE_URL` are set by `docker-compose.yml`.

### Configuration reference

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | no | `development` (default), `production` or `test` |
| `PORT` / `HOST` | no | Defaults `3100` / `127.0.0.1` |
| `DATABASE_URL` | yes | `postgres://` URL; never logged |
| `DB_PASSWORD` | Compose | Used by the `db` container and the app's `DATABASE_URL` |
| `DEVICE_KEY` | yes | At least 32 characters; the placeholder is rejected; never logged |
| `PHOTO_DIR` | yes | Absolute, or relative to the repository root |
| `MAX_PHOTO_BYTES` | no | Default `500000` |
| `PUBLIC_BASE_URL` | yes | Public http(s) origin of the site |
| `SERVE_PHOTOS` | no | Serve `/photos/*` from Node; defaults to `true` only in development |
| `TRUST_PROXY` | no | Comma-separated proxy addresses trusted for `X-Forwarded-*` (default `127.0.0.1,::1`) |
| `DISPLAY_TIMEZONE` | no | IANA zone for stats and CSV when the client sends no `tz` (default `UTC`; `.env.example` uses `Asia/Dhaka`) |
| `LOG_LEVEL` | no | Pino level, default `info` |

The server checks all of these at startup and exits with a list of the variables that are wrong.
The list never includes their values.

## Running checks

```bash
npm run db:up        # tests need the database on 127.0.0.1:5433
npm test             # server tests (recreate sylvan_test) then dashboard tests (jsdom)
npm run test:server  # or test:web for one workspace
npm run typecheck
npm run lint
npm run format       # or format:check
server/scripts/test-upload.sh   # end-to-end curl demo against a running server
```

Tests use `TEST_DATABASE_URL` when set. Otherwise they use `DATABASE_URL` with the database renamed
to `sylvan_test`. They refuse any database whose name does not end in `_test`, and each run uses a
temporary photo directory. `npm run fixtures -w server` regenerates the JPEG test fixture with
`jpeg-js`.

## API contract for the ESP32

### `POST /api/samples`

```text
POST /api/samples?ok=1&t=30.0&h=66.0&l=235
X-Device-Key: <DEVICE_KEY>
X-Upload-Id: a1b2c3d4-17          (optional, recommended)
Content-Type: image/jpeg          (may be omitted when the body is empty)
<raw JPEG bytes, or empty body if the photo failed>
```

| Query | Rule |
| --- | --- |
| `ok` | `1` = readings valid, `0` = sensor read failed |
| `t` | Temperature °C, −40 to 80 (stored with one decimal). Required when `ok=1`, absent when `ok=0` |
| `h` | Relative humidity %, 0 to 100 (one decimal). Required when `ok=1`, absent when `ok=0` |
| `l` | Light, whole lux 0 to 65535. Required when `ok=1`, absent when `ok=0` |

| Header | Rule |
| --- | --- |
| `X-Device-Key` | Shared secret, compared in constant time |
| `X-Upload-Id` | 1–64 of `A-Z a-z 0-9 _ -`. Use a new value per sample and the **same value when retrying** it |

The server checks requests in this order: device key, query, upload id, then body.

| Status | When | Body |
| --- | --- | --- |
| `201` | Sample stored | `{"id":42,"photo":true}` |
| `200` | `X-Upload-Id` already stored (a retry); nothing new is saved | `{"id":42,"photo":true}` (the original) |
| `400` | Invalid query, upload id or JPEG | `{"error":{"code":"INVALID_TEMPERATURE","message":"t (temperature) must be between -40 and 80"}}` |
| `401` | Missing or wrong device key | `{"error":{"code":"UNAUTHORIZED","message":"Missing or invalid device key"}}` |
| `413` | Body larger than `MAX_PHOTO_BYTES` | `{"error":{"code":"PAYLOAD_TOO_LARGE",...}}` |
| `415` | Non-empty body that is not `image/jpeg` | `{"error":{"code":"UNSUPPORTED_MEDIA_TYPE",...}}` |
| `500` | Server or database error (safe to retry with the same upload id) | `{"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}` |

`400` error codes: `INVALID_OK`, `READINGS_NOT_ALLOWED` (`ok=0` with `t`/`h`/`l`),
`INVALID_TEMPERATURE`, `INVALID_HUMIDITY`, `INVALID_LUX`, `INVALID_UPLOAD_ID`, `INVALID_PHOTO` (body
does not start with `FF D8`).

**Firmware guidance:** treat `200` and `201` as success. Retry on a network error, timeout or `5xx`,
using the same `X-Upload-Id`. Do not retry `4xx`, because repeating the same request cannot succeed.

### Read API (public)

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | `200 {"status":"ok","db":"ok"}`, or `503 {"error":{"code":"DATABASE_UNAVAILABLE",...}}` |
| `GET /api/samples` | `{"items": Sample[], "nextCursor": string \| null}`, newest first |
| `GET /api/samples/:id` | One `Sample`, or `404 {"error":{"code":"NOT_FOUND",...}}` |
| `GET /api/samples/:id/neighbors` | `{"previousId": number \| null, "nextId": number \| null}` in time order, or `404` |
| `GET /api/stats` | Aggregates for a range (see below) |
| `GET /api/export.csv` | CSV download of samples (see below) |
| `GET /photos/YYYY/MM/<uuid>.jpg` | Photo file (development only; nginx serves it in production) |

`GET /api/samples` query parameters:

- `limit`: 1–500, default 50
- `cursor`: the `nextCursor` value from the previous page
- `status`: `all` (default), `ok` or `failed`
- `from`: ISO date or date-time, inclusive
- `to`: ISO date (includes that whole UTC day) or date-time (inclusive)
- `hasPhoto`: `true` or `false` (omit for both)
- `order`: `desc` (newest first, default) or `asc`

Invalid values return `400` with `INVALID_LIMIT`, `INVALID_CURSOR`, `INVALID_STATUS`, `INVALID_DATE`,
`INVALID_HAS_PHOTO` or `INVALID_ORDER`.

```json
{
  "id": 61,
  "createdAt": "2026-09-17T16:59:15.197Z",
  "ok": true,
  "temperature": 30,
  "humidity": 66,
  "lux": 235,
  "photoUrl": "/photos/2026/09/c9235951-2dbe-44ac-9fe4-ffbee29f3ff4.jpg",
  "photoBytes": 1325
}
```

All errors use `{"error":{"code","message"}}`. Stack traces and SQL errors are never sent to clients.

### `GET /api/stats?from&to&tz`

`from` and `to` follow the same rules as `/api/samples`. `tz` is an IANA timezone used for daily
buckets; it defaults to `DISPLAY_TIMEZONE`, and an unknown zone returns `400 INVALID_TIMEZONE`. All
aggregation happens in SQL: one range scan for both periods, one daily query, and two indexed
lookups.

```json
{
  "range": { "from": "2026-09-10T18:00:00.000Z", "to": null, "tz": "Asia/Dhaka" },
  "totals": { "samples": 34, "ok": 28, "failed": 6, "successRate": 0.8235, "withPhoto": 20 },
  "metrics": {
    "temperature": { "min": 20.5, "avg": 23.8, "max": 30, "count": 28 },
    "humidity": { "min": 50.1, "avg": 63.3, "max": 71.3, "count": 28 },
    "lux": { "min": 26, "avg": 2670, "max": 8405, "count": 28 }
  },
  "previousPeriod": {
    "totals": { "samples": 30, "ok": 25, "failed": 5, "successRate": 0.8333 },
    "metrics": { "temperature": { "avg": 22.9 }, "humidity": { "avg": 62.3 }, "lux": { "avg": 1776 } }
  },
  "latest": { "id": 64, "createdAt": "2026-09-17T17:00:47.970Z", "ok": false, "...": "..." },
  "lastUploadAt": "2026-09-17T17:00:47.970Z",
  "daily": [
    { "date": "2026-09-11", "samples": 4, "ok": 2, "failed": 2, "avgTemperature": 23.3, "avgHumidity": 56.3, "avgLux": 4614 }
  ],
  "dailyTruncated": false
}
```

- `successRate` is a fraction from 0 to 1, or `null` when there are no samples.
- Temperature and humidity averages have one decimal; the lux average is a whole number.
- `previousPeriod` is the same length immediately before `from`, or `null` without `from`.
- `latest` is the newest sample in range; `lastUploadAt` is the newest sample overall.
- `daily` includes days with no samples. Without `from`, it starts at the first sample in range.
  Ranges longer than 366 days return the most recent 366 with `dailyTruncated: true`.

### `GET /api/export.csv?status&from&to&tz`

Downloads `sylvan-samples-YYYY-MM-DD.csv` as UTF-8 with a BOM, so Excel opens it correctly:

```text
id,created_at_utc,created_at_local,status,temperature_c,humidity_pct,light_lux,photo_url
63,2026-09-17T17:00:47Z,2026-09-17 23:00:47,ok,30.0,66.0,235,http://localhost:3100/photos/2026/09/b7e7….jpg
62,2026-09-17T16:59:15Z,2026-09-17 22:59:15,failed,,,,
```

- Rows are newest first and streamed in batches of 1,000, so the file is never built in memory and
  no database connection is held for the whole download.
- The export stops at 50,000 rows and ends with a `# Export truncated…` line.
- Cells are quoted per RFC 4180. Values starting with `=`, `+`, `-`, `@`, tab or carriage return get
  a `'` prefix against formula injection, except plain negative numbers in numeric columns.
- Photo URLs are absolute, using `PUBLIC_BASE_URL`.

## curl examples

```bash
KEY=<DEVICE_KEY>
API=http://127.0.0.1:3100

# Successful sample with a photo
curl -X POST "$API/api/samples?ok=1&t=30.0&h=66.0&l=235" \
  -H "X-Device-Key: $KEY" -H "X-Upload-Id: a1b2c3d4-17" \
  -H "Content-Type: image/jpeg" --data-binary @server/test/fixtures/sample.jpg
# 201 {"id":61,"photo":true}

# Retry of the same sample: returns the same id, stores nothing
# (same command again)  → 200 {"id":61,"photo":true}

# Sensor failure, no photo
curl -X POST "$API/api/samples?ok=0" -H "X-Device-Key: $KEY"
# 201 {"id":62,"photo":false}

# Wrong key
curl -X POST "$API/api/samples?ok=0" -H "X-Device-Key: wrong"
# 401 {"error":{"code":"UNAUTHORIZED","message":"Missing or invalid device key"}}

# Newest 10 successful samples, then the next page
curl "$API/api/samples?status=ok&limit=10"
curl "$API/api/samples?status=ok&limit=10&cursor=<nextCursor>"
```

`server/scripts/test-upload.sh [base-url]` runs these checks and fails if any response is wrong. It
reads `DEVICE_KEY` from the environment or `.env` and never prints it.

## Platform folder structure

```text
package.json              npm workspaces root (shared, server, web) and scripts
tsconfig.base.json        strict compiler settings shared by all packages
eslint.config.js          ESLint (typescript-eslint strict, type-checked) + Prettier
.env.example              configuration template (.env and .env.local are git-ignored)
docker-compose.yml        db (postgres:17-alpine) + app; app on 127.0.0.1:3100 only
docker-compose.db-port.yml  opt-in: publish the database on 127.0.0.1:5433 for host tools
shared/src/types.ts       Sample, SampleListResponse, UploadResponse, ... (API types)
server/
  Dockerfile              multi-stage, non-root, production dependencies only
  src/index.ts            startup, graceful SIGTERM/SIGINT shutdown
  src/app.ts              builds the Fastify app (logging, trust proxy, error shape, routes)
  src/config.ts           .env loading + Zod validation
  src/db/                 postgres client, migration runner, numbered SQL migrations
  src/routes/             health, samples (upload, read, neighbors), stats, export, photos (dev)
  src/services/           samples, stats, export (CSV stream), timezones, photoStorage
  src/lib/                auth (constant-time key check), validation, csv escaping, errors
  scripts/                seed.ts, make-fixture.ts, test-upload.sh
  test/                   Vitest suites, test DB setup, fixtures/sample.jpg
web/                      Phase 2: React dashboard (Vite)
  index.html              shell; applies the saved theme before first paint
  vite.config.ts          dev proxy for /api and /photos, build to web/dist, Vitest (jsdom)
  src/router.tsx          data router; one lazy chunk per page
  src/index.css           design tokens (colors, radii, spacing) for light and dark themes
  src/lib/                api client, query hooks, live updates, URL filters, range presets,
                          formatting, comparisons, chart gap splitting, constants, theme
  src/components/layout/  app shell, top bar, bottom tabs, range sheet, toasts, theme toggle
  src/components/ui/      buttons, cards, badges, photo, readings, relative time, states
  src/components/Lightbox.tsx
  src/pages/              overview/ (KPIs, charts), gallery, data, sample detail, not found
  src/test/               unit and component tests
deploy/                   Phase 5: nginx + production Compose (placeholder)
data/photos/              photo storage (git-ignored)
```

Later phases will add:
- **Phase 3:** a WebSocket plugin registered in `app.ts` (marked with a comment). On the dashboard:
  - Call `handleNewSample(queryClient, sample)` from `web/src/lib/live.ts` for each
    `sample.created` event. It refreshes every sample and stats query, and the toast logic can
    move there from `useNewSampleWatcher`.
  - Return `false` from `livePollInterval()` in `web/src/lib/queries.ts` while the socket is
    connected.
  - Put the device online/offline badge in the slot marked in `LastUpload.tsx`.
- **Phase 4:** admin routes and hardening (rate limits, security headers)
- **Phase 5:** `deploy/` with the nginx site, which serves `data/photos` directly with
  `SERVE_PHOTOS=false`. Because the Docker port proxy makes requests appear to come from the
  Compose network gateway, `TRUST_PROXY` must list that address.

# sylvan
# sylvan
# sylvan
