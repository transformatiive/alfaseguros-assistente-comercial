export interface ConcurrencyOptions {
  /** When provided, workers stop picking up new items once this returns true. */
  isCancelled?: () => boolean;
}

/** Run async tasks with a fixed concurrency cap. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: ConcurrencyOptions = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      if (opts.isCancelled?.()) return;
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
