# Security

Project Sylvan is an academic project: it will be demonstrated on a public subdomain of a shared
VPS, then retired. This document describes the trust model in plain language — what is public,
what the one write path is, what limits apply, and what is deliberately not built, and why that is
an acceptable choice here.

## The trust model in one paragraph

Almost the entire API is **public and read-only**. The single exception is
`POST /api/samples`, which requires the rover's device key. There are no user accounts, no
sessions, no cookies, no admin area, and no way to change or delete data from a browser. Deleting
data (a sample, a photo) can only be done by hand, on the server, by someone with shell access —
never through the API.

## What is public

Everything except the upload endpoint is unauthenticated by design, because the dashboard itself
is meant to be shared and browsed by anyone:

- `GET /api/samples`, `/api/samples/:id`, `/api/samples/:id/neighbors`
- `GET /api/stats`, `/api/explore`, `/api/export.csv`
- `GET /api/device`, `/api/device/events` — see "Why the device event log is public" below
- `GET /api/health`
- `GET /photos/*` (development only; nginx serves this directly in production)
- `WS /ws/live` — the public viewer channel described in the Phase 3 README section

None of these can write anything. `GET /api/export.csv` and `GET /photos/*` only ever read files
that already exist; they cannot create, modify or delete anything either.

## The one write path

`POST /api/samples` is authenticated by `X-Device-Key`, checked with a constant-time comparison
(`crypto.timingSafeEqual`), and is the **only** way any data enters the system. It can only ever
**add** a new sample row and, optionally, one photo file — it cannot edit or delete an existing
sample. The key is never logged (see "Log hygiene" below) and is rate-limited (see "Rate limits").

`WS /ws/device` is the realtime counterpart of this same write path: the same device key
authenticates it, before the WebSocket handshake completes, and it can only send heartbeats and
live video frames — again, nothing that reads, edits or deletes stored data.

## Rate limits

See the root README's "Rate limits" section for the exact numbers. In short: public read
endpoints are capped per IP, the CSV export has a stricter budget because it can stream up to
50,000 rows, uploads are capped by the device key (not the IP, since the rover sits behind NAT),
and a wrong or missing key is rate-limited per IP to slow down key-guessing. `/api/health` is
exempt so monitoring keeps working under load. All limits return `429` with the same
`{ "error": { "code": "RATE_LIMITED", "message": "..." } }` shape as every other error, plus a
`Retry-After` header, and never reveal how close a client is to the limit.

## What is intentionally not implemented, and why that is fine here

- **No user accounts or admin area.** There is nothing in this system that needs per-user
  permissions: every reading is public by design, and there is no private data to protect behind
  a login.
- **No data deletion from the web.** The only two ways data grows are one upload at a time from
  the rover, and the seed script (which refuses to run without `SEED_CONFIRM=yes`). Neither
  requires a deletion feature to stay manageable for a semester-long academic project. Disk usage
  is monitored (`/api/health`'s `disk` field, `scripts/disk-report.ts`), not auto-managed — see
  the root README.
- **No remote capture command.** An earlier phase reserved a `capture` message so an admin could
  ask the rover to take a photo on demand. Phase 4 removes it entirely (message type, schema,
  handler, and the disabled Live-page button) rather than leaving it half-built, because no admin
  route will ever exist for it to serve. The rover keeps sampling and photographing on its own.
- **No `Origin` check on `/ws/live`.** This channel is public, read-only and requires no
  credentials of any kind, so there is no session or cookie for a malicious page to ride on — the
  classic reason to check `Origin` (cross-site WebSocket hijacking of an authenticated session)
  does not apply. If a future phase ever adds cookie-based authentication to anything, that is the
  moment to add the check, not before.

## Why the device event log is public

`GET /api/device/events` is left public rather than moved behind (nonexistent) authentication.
Its rows hold only: an event type (`connected`/`disconnected`/`boot`/`timeout`), a timestamp, and
a `detail` object that can contain signal strength, uptime, firmware version, boot id, and a
WebSocket close code/reason. `GET /api/device` already exposes the current values of all of these
live. No IP addresses, device keys, or any other credential ever reach this table — confirmed by
code review of `services/deviceEvents.ts`, which only ever calls `record()` with the fields listed
above.

## Log hygiene

The device key must never reach a log line, in any of its forms:

- The HTTP header (`X-Device-Key`) is redacted by Pino's `redact` configuration in `app.ts`.
- The WebSocket query-string form (`/ws/device?key=...`, offered only for debugging — prefer the
  header) is never logged: `realtime/index.ts` explicitly avoids logging `request.url` on that
  path, and Fastify's request logger never sees WebSocket upgrade requests at all (they are
  handled on the raw `http.Server`, bypassing Fastify's normal request pipeline entirely).
- Rate-limit bucket keys are a SHA-256 hash of the device key (`lib/rateLimits.ts`), never the raw
  key, and are not logged either.
- Verified directly: after exercising every endpoint (valid and invalid uploads, both key forms
  on the WebSocket) and grepping the container's logs for the real key and for a wrong key used in
  testing, neither string appeared anywhere.

## Error handling

Every error response uses the same shape, `{ "error": { "code", "message" } }`, and never includes
a stack trace, SQL text, or file paths. A forced internal error (verified with a test that makes a
database trigger throw) still returns a generic `INTERNAL_ERROR` body; the real detail is logged
server-side only, for whoever has shell access to the container.

A thrown error or rejected promise inside a WebSocket message handler cannot crash the process:
each handler's body is wrapped in its own `try`/`catch` (`realtime/deviceChannel.ts`,
`viewerChannel.ts`), and `index.ts` additionally installs `process.on('uncaughtException'/
'unhandledRejection')` handlers that log and continue, as a last-resort net, rather than exit —
on a shared VPS, a crash-and-restart loop triggered by one malformed message would be worse than
logging it and carrying on.

## CORS

No CORS headers are set, and no `@fastify/cors`-style plugin is registered. This is deliberate:
the browser's same-origin policy is the correct default here, since the dashboard is always served
from the same origin as the API (via nginx in production, via Vite's dev proxy locally), and the
ESP32 firmware is not a browser and does not need or benefit from CORS headers at all.

## Dependencies

`npm audit` reports zero known vulnerabilities as of this phase (see the root README's deliverables
section for the exact command output). There are no accepted/ignored advisories at this time.

## Verified robustness

- **Database restart:** stopping and restarting the `db` container while the app is running
  produces a clean `503` from `/api/health` and a generic `500` from other endpoints while the
  database is down, with no stack trace or connection string in the response, and the app
  container recovers on its own once the database returns — it is never restarted itself.
- **Read-only photo directory:** an upload targeting a read-only destination folder fails with a
  generic `500`, leaves no half-written temp file behind, does not insert an orphan database row,
  and does not crash the app.
- **Malformed input:** invalid or malicious-looking query parameters and path segments (null
  bytes, overlong UTF-8, SQL-injection-shaped strings, negative and absurdly large numbers,
  unicode) return `400` or `404` on every endpoint, never `500`. An oversized query string is
  rejected by Node's own HTTP header-size limit (`431`) before it reaches the application.
