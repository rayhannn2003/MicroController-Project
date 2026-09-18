/** One stop of the rover, as returned by the public API. Timestamps are ISO 8601 UTC. */
export interface Sample {
  id: number;
  createdAt: string;
  /** False when the rover's sensor read failed; readings are then null. */
  ok: boolean;
  /** Air temperature in °C, one decimal. */
  temperature: number | null;
  /** Relative humidity in %, one decimal. */
  humidity: number | null;
  /** Ambient light in lux. */
  lux: number | null;
  /** Path such as `/photos/2026/09/<uuid>.jpg`, or null when no photo was stored. */
  photoUrl: string | null;
  photoBytes: number | null;
}

export interface SampleListResponse {
  items: Sample[];
  /** Pass as `cursor` to fetch the next (older) page; null on the last page. */
  nextCursor: string | null;
}

/** Response to `POST /api/samples` (201 when created, 200 when the upload id already existed). */
export interface UploadResponse {
  id: number;
  photo: boolean;
}

export type SampleStatusFilter = 'all' | 'ok' | 'failed';

export type SampleOrder = 'desc' | 'asc';

/** Query parameters accepted by `GET /api/samples`. Dates are ISO 8601 strings. */
export interface SampleListParams {
  limit?: number;
  cursor?: string;
  status?: SampleStatusFilter;
  from?: string;
  to?: string;
  /** Only samples with (`true`) or without (`false`) a photo. */
  hasPhoto?: boolean;
  /** `desc` (newest first, default) or `asc` (oldest first). */
  order?: SampleOrder;
}

/** Query parameters accepted by `GET /api/stats`. */
export interface StatsParams {
  from?: string;
  to?: string;
  /** IANA timezone used for daily buckets; defaults to the server's DISPLAY_TIMEZONE. */
  tz?: string;
}

/** Query parameters accepted by `GET /api/export.csv`. */
export interface ExportParams {
  status?: SampleStatusFilter;
  from?: string;
  to?: string;
  tz?: string;
}

export interface MetricSummary {
  min: number | null;
  avg: number | null;
  max: number | null;
  /** Number of samples that have this reading (successful samples). */
  count: number;
}

export interface PeriodTotals {
  samples: number;
  ok: number;
  failed: number;
  /** `ok / samples` as a fraction from 0 to 1; null when there are no samples. */
  successRate: number | null;
}

export interface DailyStats {
  /** Calendar day `YYYY-MM-DD` in the requested timezone. */
  date: string;
  samples: number;
  ok: number;
  failed: number;
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgLux: number | null;
}

export interface StatsResponse {
  range: { from: string | null; to: string | null; tz: string };
  totals: PeriodTotals & { withPhoto: number };
  metrics: {
    temperature: MetricSummary;
    humidity: MetricSummary;
    lux: MetricSummary;
  };
  /** The same-length period immediately before `from`; null when `from` is not set. */
  previousPeriod: {
    totals: PeriodTotals;
    metrics: {
      temperature: { avg: number | null };
      humidity: { avg: number | null };
      lux: { avg: number | null };
    };
  } | null;
  /** Newest sample inside the range. */
  latest: Sample | null;
  /** Newest sample overall, regardless of range. */
  lastUploadAt: string | null;
  /** One entry per day in the range, including days without samples (at most 366). */
  daily: DailyStats[];
  /** True when the range spans more than 366 days and only the most recent 366 are returned. */
  dailyTruncated: boolean;
}

export interface NeighborsResponse {
  /** The sample immediately before this one in time order. */
  previousId: number | null;
  /** The sample immediately after this one in time order. */
  nextId: number | null;
}

export interface HealthResponse {
  status: 'ok';
  db: 'ok';
  /** Present when the realtime (WebSocket) server is running. */
  ws?: { viewers: number; deviceOnline: boolean };
  /** Photo storage usage, refreshed periodically (not computed per request). */
  disk: { photoBytes: number; photoCount: number };
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

/* ------------------------------------------------------------------------------------------------
 * Realtime (Phase 3)
 * ---------------------------------------------------------------------------------------------- */

/** Current rover status, from `GET /api/device` and the `/ws/live` channel. */
export interface DeviceStatus {
  /** Socket open and a heartbeat received within DEVICE_TIMEOUT_S. */
  online: boolean;
  /** Last heartbeat, frame or connection; survives server restarts. */
  lastSeenAt: string | null;
  connectedAt: string | null;
  /** WiFi signal in dBm. */
  rssi: number | null;
  uptimeS: number | null;
  freeHeap: number | null;
  /** The device reports it is sending frames. */
  streaming: boolean;
  /** Viewers currently watching the live stream. */
  viewers: number;
  fw: string | null;
}

export type DeviceEventType = 'connected' | 'disconnected' | 'boot' | 'timeout';

export interface DeviceEvent {
  id: number;
  createdAt: string;
  type: DeviceEventType;
  detail: {
    rssi?: number;
    uptimeS?: number;
    fw?: string;
    bootId?: string;
    code?: number;
    reason?: string;
  } | null;
}

export interface DeviceEventsResponse {
  items: DeviceEvent[];
}

/**
 * WebSocket close codes used by `/ws/device` and `/ws/live` (values live in each workspace because
 * this package is types only): 1001 server shutdown, 4002 replaced by a newer device connection,
 * 4003 too many invalid messages, 4008 viewer too slow.
 */
export type CloseCode = 1001 | 4002 | 4003 | 4008;

// Device → server
export interface DeviceHelloMessage {
  type: 'hello';
  fw?: string;
  bootId?: string;
  ip?: string;
}

export interface DeviceHeartbeatMessage {
  type: 'heartbeat';
  rssi?: number;
  uptimeS?: number;
  freeHeap?: number;
  streaming?: boolean;
}

export type DeviceMessage = DeviceHelloMessage | DeviceHeartbeatMessage;

// Server → device
export interface ServerViewersMessage {
  type: 'viewers';
  count: number;
}

export interface ServerConfigMessage {
  type: 'config';
  targetFps: number;
  jpegQuality: number;
}

export type ServerToDeviceMessage = ServerViewersMessage | ServerConfigMessage;

// Server → viewer
export type StreamState = 'starting' | 'live' | 'stopped';
export type StreamStopReason = 'device_offline' | 'no_viewers' | 'viewer_left';

export type ServerToViewerMessage =
  | { type: 'hello'; serverTime: string; device: DeviceStatus }
  | { type: 'device.status'; device: DeviceStatus }
  | { type: 'sample.created'; sample: Sample }
  | { type: 'stream.state'; state: StreamState; reason: StreamStopReason | null };

// Viewer → server
export interface ViewerWatchMessage {
  type: 'watch';
  on: boolean;
}

/* ------------------------------------------------------------------------------------------------
 * Explore analytics (Phase 4)
 * ---------------------------------------------------------------------------------------------- */

export interface ExplorePoint {
  id: number;
  at: string;
  temperature: number;
  humidity: number;
  lux: number;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

export interface Histogram {
  min: number;
  max: number;
  binWidth: number;
  bins: HistogramBin[];
}

export interface ExploreCorrelations {
  /** Pearson r, rounded to 3 decimals; null when count < 3 or a variable is constant. */
  temperatureHumidity: number | null;
  temperatureLux: number | null;
  humidityLux: number | null;
}

export interface ExploreHourlyBucket {
  /** 0..23, in the requested timezone. */
  hour: number;
  count: number;
  avgTemperature: number | null;
  avgHumidity: number | null;
  avgLux: number | null;
}

export interface ExploreResponse {
  range: { from: string | null; to: string | null; tz: string };
  /** OK samples only; failed samples have no readings. */
  count: number;
  points: ExplorePoint[];
  /** True when `points` was downsampled below `count` (see the API docs for the rule). */
  pointsTruncated: boolean;
  histograms: {
    temperature: Histogram;
    humidity: Histogram;
    lux: Histogram;
  };
  correlations: ExploreCorrelations;
  hourly: ExploreHourlyBucket[];
}
