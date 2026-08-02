type Entry = { value: any; expires: number };

const store = new Map<string, Entry>();
const MAX = 300;

/** Memoise an async call for `ttl` ms. Warm lambdas skip repeat network work. */
export async function memo<T>(key: string, fn: () => Promise<T>, ttl = 10 * 60_000): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const value = await fn();

  if (store.size >= MAX) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
  store.set(key, { value, expires: now + ttl });
  return value;
}
