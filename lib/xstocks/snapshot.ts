/**
 * Snapshots of public chain state kept in the engine state table. A scheduled job reads X Layer and
 * stores what a public API serves; the API reads the snapshot while it is fresh and reads X Layer
 * itself only when it is not. A public GET only ever reads a snapshot: the scheduled job writes it.
 */
import { EngineRepository } from "../engine/repository";
import type { EngineEnv } from "../engine/types";

type Db = EngineEnv["DB"];
export type Snapshot<T> = { body: T; readAt: number };

/** The scheduled job's write: the body and when X Layer was read. */
export async function storeSnapshot<T>(db: Db, key: string, body: T, readAt: number): Promise<Snapshot<T>> {
  const snapshot = { body, readAt };
  await new EngineRepository(db).setState(key, JSON.stringify(snapshot));
  return snapshot;
}

/** The last stored snapshot, or null. */
export async function readSnapshot<T>(db: Db, key: string): Promise<Snapshot<T> | null> {
  const raw = (await new EngineRepository(db).getState(key))?.value;
  if (!raw) return null;
  try {
    const snapshot = JSON.parse(raw) as Snapshot<T>;
    return snapshot && typeof snapshot.readAt === "number" && snapshot.body && typeof snapshot.body === "object" ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * What a public request serves: the snapshot while it is under freshMs old, otherwise a read of X
 * Layer now, otherwise (X Layer down) a snapshot up to staleMs old, marked stale. Reads only.
 */
export async function snapshotOrRead<T>(db: Db, key: string, read: () => Promise<T>, options: { freshMs: number; staleMs: number; now?: () => number }): Promise<Snapshot<T> & { stale: boolean }> {
  const now = options.now ?? Date.now;
  const snapshot = await readSnapshot<T>(db, key).catch(() => null);
  const age = snapshot ? now() - snapshot.readAt : Infinity;
  if (snapshot && age < options.freshMs) return { ...snapshot, stale: false };
  try {
    return { body: await read(), readAt: now(), stale: false };
  } catch (error) {
    if (snapshot && age < options.staleMs) return { ...snapshot, stale: true };
    throw error;
  }
}
