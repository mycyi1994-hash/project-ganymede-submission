/**
 * A read kept in this Worker isolate for a few seconds, so a burst of requests for the same public
 * chain state costs one read of X Layer instead of one each. Requests that arrive while a read is
 * running wait for that read. When a read fails, the last good value is served for a while longer,
 * marked as stale. Nothing is written anywhere: the value lives only in this isolate's memory and is
 * gone when the isolate is.
 *
 * Cloudflare's Cache API does nothing on workers.dev, and public GET requests must not write to the
 * engine database, so memory is the cache that fits.
 */

type Entry<T> = { value?: T; readAt?: number; pending?: Promise<T> };

const entries = new Map<string, Entry<unknown>>();

export type CachedRead<T> = { value: T; readAt: number; stale: boolean };

export async function cachedRead<T>(
  key: string,
  read: () => Promise<T>,
  options: { freshMs: number; staleMs: number; now?: () => number },
): Promise<CachedRead<T>> {
  const now = options.now ?? Date.now;
  const entry = (entries.get(key) ?? {}) as Entry<T>;
  entries.set(key, entry);
  if (entry.readAt !== undefined && now() - entry.readAt < options.freshMs) return { value: entry.value as T, readAt: entry.readAt, stale: false };
  if (!entry.pending) {
    entry.pending = read().then(value => {
      entry.value = value;
      entry.readAt = now();
      return value;
    }).finally(() => { entry.pending = undefined; });
  }
  try {
    const value = await entry.pending;
    return { value, readAt: entry.readAt as number, stale: false };
  } catch (error) {
    if (entry.readAt !== undefined && now() - entry.readAt < options.staleMs) return { value: entry.value as T, readAt: entry.readAt, stale: true };
    throw error;
  }
}

/** Forgets every kept read; for tests. */
export function clearReadCache() {
  entries.clear();
}
