// ==== Async Helper ====
const AsyncHelpers = {
  /**
   * Fuehrt async Aufgaben mit Concurrency-Limit aus.
   * @template T,U
   * @param {T[]} items
   * @param {number} limit
   * @param {(item: T, index: number) => Promise<U>} mapper
   * @returns {Promise<(U|null)[]>}
   */
  async mapWithConcurrency(items, limit, mapper) {
    const arr = Array.isArray(items) ? items : [];
    const n = arr.length;
    const results = new Array(n).fill(null);
    const k = Math.max(1, Math.min(limit || 1, n));
    let next = 0;
    const worker = async () => {
      while (true) {
        const i = next++;
        if (i >= n) break;
        try {
          results[i] = await mapper(arr[i], i);
        } catch (_) {
          results[i] = null;
        }
      }
    };
    const workers = [];
    for (let i = 0; i < k; i++) workers.push(worker());
    await Promise.all(workers);
    return results;
  }
};

