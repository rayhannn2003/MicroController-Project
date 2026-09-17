CREATE TABLE samples (
  id           BIGSERIAL PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  upload_id    TEXT UNIQUE,
  ok           BOOLEAN NOT NULL,
  temperature  NUMERIC(5,1),
  humidity     NUMERIC(5,1),
  lux          INTEGER,
  photo_key    TEXT,
  photo_bytes  INTEGER,
  CONSTRAINT readings_match_status CHECK (
    (ok AND temperature IS NOT NULL AND humidity IS NOT NULL AND lux IS NOT NULL)
    OR
    (NOT ok AND temperature IS NULL AND humidity IS NULL AND lux IS NULL)
  )
);

CREATE INDEX samples_created_at_idx ON samples (created_at DESC, id DESC);
