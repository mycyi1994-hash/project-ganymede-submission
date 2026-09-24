/**
 * Idempotency ledger. Keyed by the engine's own Idempotency-Key
 * (`entityType:entityId:action`), so a retry returns the first result instead
 * of producing a second transaction.
 */
export interface StoredSettlement {
  key: string;
  status: "queued" | "submitted" | "confirmed" | "failed";
  txHash: string | null;
  blockNumber: string | null;
  error: string | null;
  note: string | null;
  updatedAt: string;
}

export async function readSettlement(db: D1Database, key: string): Promise<StoredSettlement | null> {
  const row = await db
    .prepare(
      "SELECT key, status, tx_hash, block_number, error, note, updated_at FROM relayer_settlements WHERE key = ?",
    )
    .bind(key)
    .first<{
      key: string;
      status: StoredSettlement["status"];
      tx_hash: string | null;
      block_number: string | null;
      error: string | null;
      note: string | null;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    key: row.key,
    status: row.status,
    txHash: row.tx_hash,
    blockNumber: row.block_number,
    error: row.error,
    note: row.note,
    updatedAt: row.updated_at,
  };
}

export async function writeSettlement(db: D1Database, record: StoredSettlement): Promise<void> {
  await db
    .prepare(
      `INSERT INTO relayer_settlements (key, status, tx_hash, block_number, error, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         status = excluded.status,
         tx_hash = COALESCE(excluded.tx_hash, relayer_settlements.tx_hash),
         block_number = COALESCE(excluded.block_number, relayer_settlements.block_number),
         error = excluded.error,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .bind(
      record.key,
      record.status,
      record.txHash,
      record.blockNumber,
      record.error,
      record.note,
      record.updatedAt,
    )
    .run();
}
