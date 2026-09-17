CREATE TABLE device_events (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  type        TEXT NOT NULL,          -- connected | disconnected | boot | timeout
  detail      JSONB,                  -- rssi, uptimeS, fw, close code/reason
  CONSTRAINT device_events_type_check CHECK (type IN ('connected','disconnected','boot','timeout'))
);
CREATE INDEX device_events_created_at_idx ON device_events (created_at DESC, id DESC);
