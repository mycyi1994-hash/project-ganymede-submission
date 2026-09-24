-- Relayer idempotency ledger.
-- The key is the engine's own Idempotency-Key: `entityType:entityId:action`.
CREATE TABLE IF NOT EXISTS relayer_settlements (
  key           TEXT PRIMARY KEY NOT NULL,
  status        TEXT NOT NULL,
  tx_hash       TEXT,
  block_number  TEXT,
  error         TEXT,
  note          TEXT,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS relayer_settlements_status_idx ON relayer_settlements (status);
CREATE INDEX IF NOT EXISTS relayer_settlements_updated_idx ON relayer_settlements (updated_at);
