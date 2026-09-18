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
3. **Realtime** (done): device heartbeat, live camera stream, instant updates
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

## What Phase 3 includes

- **`WS /ws/device`**: one authenticated rover connection for heartbeats, live JPEG frames and
  server commands (full contract below).
- **`WS /ws/live`**: public, read-only viewer channel. It pushes device status, new samples and
  live frames, and fans one device stream out to every watching viewer.
- **True device status** on the dashboard (Online with signal strength, or Offline with the last
  contact time), replacing the "last upload" guess. `GET /api/device` serves the same data over
  plain HTTP for networks that block WebSockets.
- **Instant sample updates**: uploads appear immediately instead of within 15 seconds. Polling
  stays as the fallback and turns itself off while the socket is open.
- **Live camera page** (`/live`) that only asks the rover to stream while someone is watching.
- `device_events` table recording connect, disconnect, boot and heartbeat-timeout events, so
  "last seen" survives a restart.

## What Phase 4 includes

- **`GET /api/explore`**: analysis-ready data for a range — a downsampled scatter, per-metric
  histograms, Pearson correlations and an hour-of-day breakdown, all computed in SQL. Powers the
  **Explore** page (`/explore`): a scatter plot with axis pickers and a plain-language correlation
  read-out, distribution histograms with a "general indoor-plant guideline" band and the share of
  samples inside it, and a daily pattern chart.
- **Rate limiting** (`@fastify/rate-limit`, in-memory, no Redis) on every endpoint, and a cap on
  new `/ws/live` connections per IP per minute — see "Rate limits" below.
- **Security headers** (`@fastify/helmet`), including a Content-Security-Policy — see "Security
  headers" below.
- **Hardening**: a small (16 KB) global request body limit, request/connection timeouts, and
  `process.on('uncaughtException'/'unhandledRejection')` as a last-resort safety net so one bad
  request or WebSocket message cannot take the whole server down.
- **Disk usage**: `GET /api/health` reports photo storage size and count, and
  `server/scripts/disk-report.ts` prints a one-off summary. Nothing is ever deleted automatically.
- **`SECURITY.md`** describes the full trust model: what is public, the one write path, what is
  intentionally not built (accounts, admin actions, deletion), and why that is fine for this
  project.
- **Removed** the Phase 3 remote-capture placeholder entirely (message types, schema, handler, the
  disabled Live-page button) — see "Later phases" below for why.

`POST /api/samples` (with the device key) is the **only** write path in the whole system; every
other endpoint is read-only. See `SECURITY.md` for the full reasoning.

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
| `DEVICE_TIMEOUT_S` | no | Offline after this long without a heartbeat (default `30`) |
| `MAX_FRAME_BYTES` | no | Largest accepted live frame (default `200000`) |
| `SLOW_VIEWER_BYTES` | no | Skip frames for a viewer with this much unsent data (default `200000`) |
| `STREAM_TARGET_FPS` / `STREAM_JPEG_QUALITY` | no | Sent to the rover in `config` (defaults `5` / `65`) |
| `MAX_VIEWERS` | no | Simultaneous `/ws/live` connections (default `50`) |
| `WS_MAX_MESSAGE_BYTES` | no | Hard per-message cap, must be ≥ `MAX_FRAME_BYTES` (default `262144`) |
| `LOG_LEVEL` | no | Pino level, default `info` |

The server checks all of these at startup and exits with a list of the variables that are wrong.
The list never includes their values.

Rate limits, the CSP, body-size and timeout limits are **not** environment variables: they are
fixed security policy (see "Rate limits" and "Security headers" below), not per-deployment tuning.
They are always on when the server starts via `npm start` / `node dist/index.js` (what
`docker-compose.yml` runs); only the test suite can turn them off, for tests that fire many rapid
requests in under a second.

## Running checks

```bash
npm run db:up        # tests need the database on 127.0.0.1:5433
npm test             # server tests (recreate sylvan_test) then dashboard tests (jsdom)
npm run test:server  # or test:web for one workspace
npm run typecheck
npm run lint
npm run format       # or format:check
server/scripts/test-upload.sh   # end-to-end curl demo against a running server
npm run disk:report             # how much disk photos are using (read-only, never deletes)
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
| `GET /api/explore` | Analysis-ready data for a range: scatter points, histograms, correlations, hourly pattern (see below) |
| `GET /api/device` | Current `DeviceStatus` (also pushed over `/ws/live`) |
| `GET /api/device/events?limit=` | Recent connect/disconnect/boot/timeout events (1–100, default 20) |
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

### `GET /api/explore?from&to&tz&bins`

`from`, `to` and `tz` follow the same rules as `/api/stats`. `bins` sets the histogram resolution:
1–30, default 12. Only successful (`ok=true`) samples are considered; a failed sample has no
readings to plot. Everything is computed in SQL (`width_bucket`, `corr()`, `extract(hour from …)`),
never by loading every row into Node.

```json
{
  "range": { "from": "2026-09-10T18:00:00.000Z", "to": null, "tz": "Asia/Dhaka" },
  "count": 62,
  "points": [
    { "id": 1, "at": "2026-09-10T20:00:53.927Z", "temperature": 22.5, "humidity": 61.3, "lux": 78 }
  ],
  "pointsTruncated": false,
  "histograms": {
    "temperature": {
      "min": 20.5, "max": 30, "binWidth": 1.1875,
      "bins": [{ "from": 20.5, "to": 21.6875, "count": 16 }]
    },
    "humidity": { "min": 50.1, "max": 71.3, "binWidth": 2.65, "bins": ["..."] },
    "lux": { "min": 19, "max": 8546, "binWidth": 1065.875, "bins": ["..."] }
  },
  "correlations": {
    "temperatureHumidity": -0.377, "temperatureLux": 0.409, "humidityLux": -0.484
  },
  "hourly": [
    { "hour": 0, "count": 3, "avgTemperature": 21.5, "avgHumidity": 64.8, "avgLux": 666 }
  ]
}
```

- `points`: at most 2,001 rows (the 2,000-point cap plus one guaranteed slot for the very last
  sample, so the plotted range never falls short of the true range), evenly downsampled by row
  number when there are more. `pointsTruncated` is `true` whenever `count` exceeds the cap.
- `histograms`: one bin count per metric. Bounds are rounded outward to a display-friendly
  precision (temperature/humidity to 1 decimal, lux to a whole number) — they cover, and may
  slightly exceed, the true min/max. When every value in range is identical, the histogram is a
  single bin of width 0 containing every sample, instead of dividing by zero. An empty range
  returns `count: 0`, empty `bins`/`points`/`hourly` counts, and every correlation `null` — never
  an error.
- `correlations`: Pearson's r, rounded to 3 decimals, `null` when there are fewer than 3 samples
  or a variable never varies (both make a correlation coefficient meaningless, not just unlucky).
- `hourly`: always all 24 hours, in the requested timezone, zero-filled where there is no data —
  the dashboard visually de-emphasizes hours with fewer than 3 samples rather than hiding them.
- `INVALID_BINS` (bins outside 1–30) joins the usual `INVALID_TIMEZONE`/`INVALID_DATE` errors.

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

## WebSocket contract for the ESP32-CAM (`/ws/device`)

This is the contract the firmware is written against. `server/scripts/fake-device.ts` is a working
reference implementation:

```bash
npx tsx server/scripts/fake-device.ts --fps 5      # uses DEVICE_KEY from .env
```

### Connecting

```text
GET /ws/device HTTP/1.1
Host: sylvan.example.com
Upgrade: websocket
X-Device-Key: <DEVICE_KEY>
```

- The key may instead be sent as `/ws/device?key=<DEVICE_KEY>`, which helps when debugging with a
  tool that cannot set headers. **Prefer the header**: query strings show up in proxy and browser
  logs. The server never logs either form.
- A missing or wrong key is refused with **HTTP 401 before the upgrade**, so the device sees a
  normal HTTP failure rather than a silent close. Unknown paths get 404.
- Only one device is connected at a time. A new authenticated connection is accepted and the older
  socket is closed with **4002 `replaced`**, so a rebooted rover is never locked out by its own
  stale socket.
- Use `wss://` in production. The rover should reconnect with exponential backoff (1 s up to 30 s,
  with jitter) on any close or network error.

### Device → server

| Message | When | Notes |
| --- | --- | --- |
| `{"type":"hello","fw":"sylvan-esp32cam 1.0.0","bootId":"a1b2c3","ip":"192.168.0.105"}` | Once, right after connecting | All fields except `type` are optional. A `bootId` that differs from the last one recorded writes a `boot` event, so keep it stable until the next reset. |
| `{"type":"heartbeat","rssi":-62,"uptimeS":1840,"freeHeap":142000,"streaming":true}` | Every 10 s | All fields optional. `rssi` −127..0, `uptimeS`/`freeHeap` ≥ 0. |
| Binary frame | Only while `viewers > 0` | A complete JPEG starting with `FF D8`, at most `MAX_FRAME_BYTES` (200 KB). |
| `{"type":"capture.result","requestId":"…","ok":true,"sampleId":42}` | Phase 4 | Accepted and logged; the matching `capture` command cannot be sent until the admin API exists. |

Heartbeats must be more frequent than `DEVICE_TIMEOUT_S` (default 30 s); 10 s gives two chances to
miss one. Anything from 5 s to 60 s works if `DEVICE_TIMEOUT_S` is at least twice the interval.

### Server → device

| Message | When |
| --- | --- |
| `{"type":"config","targetFps":5,"jpegQuality":65}` | On connect, from server configuration, so stream settings can change without reflashing |
| `{"type":"viewers","count":2}` | On connect and whenever the count changes. Start streaming while `count > 0`, stop at `0`. |
| `{"type":"capture","requestId":"…"}` | Phase 4 only (admin-triggered); never sent today |

Viewer updates are debounced (about 250 ms before a start, 3 s before a stop, at most one message
per second), so opening and closing the Live page quickly does not make the camera flap.

### Keepalive, limits and close codes

- The server sends a WebSocket **ping every 20 s** and terminates the connection after two
  unanswered pings. Reply with a pong (most libraries do this automatically).
- Invalid messages increase a counter: malformed JSON, a `hello`/`heartbeat` with out-of-range
  fields, a binary frame that does not start with `FF D8`, or one larger than `MAX_FRAME_BYTES`.
  **More than 10** closes the connection with **4003**. Unknown `type` values are ignored and do
  not count.
- Text messages are limited to 1 KB; any message above `WS_MAX_MESSAGE_BYTES` (256 KB) closes the
  connection with the standard code 1009.
- Frames arriving faster than ~10 fps are dropped by the server; frames sent while nobody is
  watching are discarded.

| Close code | Meaning | What the firmware should do |
| --- | --- | --- |
| `1001` | Server shutting down or restarting | Reconnect with backoff |
| `1009` | Message larger than the hard limit | Lower the resolution or quality, then reconnect |
| `4002` | Replaced by a newer device connection | Do not reconnect in a loop; this connection is stale |
| `4003` | Too many invalid messages | Fix the payloads before reconnecting |

### Viewer channel (`/ws/live`, public)

Dashboards connect here; the rover does not. The server sends `hello`, `device.status`,
`sample.created` and `stream.state` as JSON, plus JPEG frames as binary messages. A viewer sends
`{"type":"watch","on":true}` to start receiving frames and `{"on":false}` to stop; only watching
viewers count toward the rover's viewer count. Viewers that cannot keep up (more than
`SLOW_VIEWER_BYTES` of unsent data for over 10 seconds) are closed with **4008** so one slow phone
cannot slow the rover or the other viewers. Frames are never stored on disk or in the database.

## Rate limits

In-memory (`@fastify/rate-limit`; the server already shares this VPS with other sites' own Redis,
so nothing new is added). A limit response always uses the standard error shape plus a
`Retry-After` header, and never reveals how many requests remain:

```json
{ "error": { "code": "RATE_LIMITED", "message": "Too many requests. Please try again shortly." } }
```

| Endpoint(s) | Limit | Key |
| --- | --- | --- |
| `GET /api/samples`, `/api/samples/:id`, `/neighbors`, `/api/stats`, `/api/explore`, `/api/device`, `/api/device/events` | 120 / minute | Client IP |
| `GET /api/export.csv` | 10 / 5 minutes | Client IP |
| `POST /api/samples`, valid device key | 60 / minute | SHA-256 hash of the device key (never the IP — the rover is behind NAT) |
| `POST /api/samples`, missing/wrong key | 20 / minute | Client IP (slows down key-guessing) |
| New `WS /ws/live` connections | 20 / minute | Client IP |
| `GET /api/health` | Exempt | — |

**IP resolution.** The app only trusts `X-Forwarded-*` headers from addresses listed in
`TRUST_PROXY`. Getting this wrong silently breaks every per-IP limit above — if the app's own
reverse proxy is not trusted, `request.ip` resolves to the proxy's address for every visitor, so
one visitor could exhaust the whole site's budget for everyone. Locally (`docker compose`), the
app is reached through Docker's published port, which itself acts like a proxy: every request
arrives from the Docker bridge network's gateway address, not the real client. `docker-compose.yml`
pins that network to a fixed subnet for exactly this reason — `172.28.90.0/24`, gateway
`172.28.90.1` — instead of Docker's default auto-assigned (and therefore unpredictable) subnet.
**Phase 5 must set:**

```bash
TRUST_PROXY=127.0.0.1,::1,172.28.90.1
```

(`127.0.0.1`/`::1` cover nginx connecting directly if it and the app ever share a network
namespace; `172.28.90.1` covers nginx connecting through the published Docker port, the actual
Phase 5 setup.) Confirm the address by running `docker network inspect sylvan_default` if the
subnet in `docker-compose.yml` is ever changed.

**WebSocket connections** bypass Fastify's request handling entirely, so the same IP is resolved
by hand with `@fastify/proxy-addr` (already a transitive Fastify dependency, added as an explicit
one here) configured with the same `TRUST_PROXY` list, kept consistent with `request.ip`.

`MAX_VIEWERS` (from Phase 3) still separately caps the *total* number of connected viewers, with a
`503` before the WebSocket handshake completes; the browser cannot distinguish "full" from a
generic network failure at that point (browsers deliberately hide the real close reason for a
failed handshake), so the Live page's message covers both possibilities honestly rather than
guessing.

## Security headers

Set by `@fastify/helmet` on every response:

```text
Content-Security-Policy: default-src 'self'; base-uri 'self'; script-src 'self';
  style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self';
  connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

(Helmet also adds a few of its own always-safe defaults, such as `script-src-attr 'none'` and
`Referrer-Policy`, not listed individually above.)

- `style-src 'unsafe-inline'` is needed because React, Recharts and Radix set inline `style`
  attributes; there is no inline `<style>` block and, importantly, no inline `<script>` — the one
  inline script from earlier phases (the theme-flash-prevention snippet in `index.html`) was moved
  to `web/public/theme-init.js` specifically so `script-src` could stay `'self'` with no
  `'unsafe-inline'` exception.
- `img-src` allows `blob:` for live camera frames (`URL.createObjectURL`) and `data:` defensively
  for chart-library internals; nothing in this app uses either for anything else.
- **`Strict-Transport-Security` is deliberately not set by the app** (`hsts: false`): the app
  cannot know whether the connection reaching it is genuinely HTTPS (nginx terminates TLS), and
  sending HSTS from a plain HTTP response would be meaningless at best.
- Verified by loading the actual production build (`npm run build`, `web/dist`) through a local
  static server configured with this exact header set: zero Content-Security-Policy violations in
  the browser console on any page.

**What nginx should set in Phase 5, to avoid duplicating or conflicting with the above:**

- `Strict-Transport-Security` — nginx is the TLS termination point, so it is the only place that
  can set this correctly.
- The identical `Content-Security-Policy` (and the other headers above) on the responses that
  serve `web/dist` (the built frontend), since the Fastify app above never serves that HTML/JS —
  only nginx does in production. The app's own headers only cover its JSON/CSV/photo responses.
- Nothing else needs duplicating: `X-Content-Type-Options` and `X-Frame-Options` are harmless to
  set twice if nginx has a house style that already adds them, but are not required there.

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
  src/routes/             health, samples (upload, read, neighbors), stats, explore, export,
                          device, photos
  src/realtime/           device channel, viewer channel, relay, status tracker, protocol
  src/services/           samples, stats, explore (histograms/correlations/hourly), export (CSV
                          stream), diskUsage, timezones, photoStorage, events (in-process bus),
                          deviceEvents (connect/boot/timeout log)
  src/lib/                auth (constant-time key check), validation, histogram (nice bounds),
                          rateLimits (policy + hashing), csv escaping, errors
  scripts/                seed.ts, make-fixture.ts, fake-device.ts, disk-report.ts, test-upload.sh
  test/                   Vitest suites, test DB setup, fixtures/sample.jpg
web/                      Phase 2: React dashboard (Vite)
  index.html              shell; applies the saved theme before first paint
  vite.config.ts          dev proxy for /api and /photos, build to web/dist, Vitest (jsdom)
  src/router.tsx          data router; one lazy chunk per page
  src/index.css           design tokens (colors, radii, spacing) for light and dark themes
  src/lib/                api client, query hooks, live updates, WebSocket client, device status
                          store, URL filters, range presets, formatting, comparisons, correlation
                          bands, chart gap splitting, color blending, constants (incl. comfort
                          ranges), theme
  src/components/layout/  app shell, top bar, bottom tabs, range sheet, toasts, theme toggle
  src/components/ui/      buttons, cards, badges, photo, readings, relative time, states
  src/components/Lightbox.tsx
  src/pages/              overview/ (KPIs, charts), gallery, data, live camera, explore/ (scatter,
                          histograms, hourly pattern), sample detail, not found
  src/test/               unit and component tests
deploy/                   Phase 5: nginx + production Compose (placeholder)
data/photos/              photo storage (git-ignored)
SECURITY.md               the trust model: what is public, the one write path, what is not built
```

**What Phase 4 deliberately does not add, and why:** no authentication, no admin area, and no way
to write, edit or delete data from the browser — `POST /api/samples` remains the only write path.
The Phase 3 remote-capture placeholder (`capture`/`capture.result` messages,
`DeviceChannel.requestCapture()`, the disabled Live-page button) is **removed**, not just left
disabled, since no admin route will ever exist in this project to call it — see `SECURITY.md`. The
`/ws/live` upgrade still has no `Origin` check, and still correctly does not need one: Phase 4 adds
no authentication and no cookies, so there is no session for a malicious page to ride on (the
classic reason to check `Origin`). That reasoning, not just the absence of a check, is recorded in
`SECURITY.md` so a future phase re-evaluates it if it ever adds cookie-based auth to anything.

Later phases will add:
- **Phase 5:** `deploy/` with the nginx site, which serves both `web/dist` (the built dashboard)
  and `data/photos` directly (`SERVE_PHOTOS=false`), and must set `TRUST_PROXY` and the security
  headers described above. WebSockets also need:

  ```nginx
  location /ws/ {
      proxy_pass http://127.0.0.1:3100;
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection "upgrade";   # required for the upgrade to pass through
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_read_timeout 300s;                 # longer than the 20 s ping interval
      proxy_send_timeout 300s;
      proxy_buffering off;                     # frames must not be buffered by nginx
  }
  ```

  Without `proxy_buffering off`, nginx would absorb frames and hide slow viewers from the server's
  backpressure checks. `proxy_read_timeout` must exceed the ping interval or nginx will drop idle
  device connections.

# sylvan
# sylvan
# sylvan
