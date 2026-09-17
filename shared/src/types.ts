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

export interface HealthResponse {
  status: 'ok';
  db: 'ok';
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}
