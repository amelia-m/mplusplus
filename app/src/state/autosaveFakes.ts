/**
 * Test fakes for autosave: browser storage and the Web Locks API, in
 * memory. Used only by the autosave tests; nothing in the app imports it.
 */
import type { SessionStorage } from './autosave.js';
import type { TabLocks } from './autosaveTabs.js';

/** `localStorage` or `sessionStorage` in memory, with its items exposed. */
export function memoryStorage(initial: Record<string, string> = {}): SessionStorage & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}

/**
 * In-memory Web Locks with the rules used here: a lock is held until its
 * holder goes, `ifAvailable` gets `null` for a held lock, a request with a
 * `signal` waits for the lock and rejects when the signal aborts, and
 * `query` lists the held locks. `close(id)` stands in for the tab holding
 * that id's lock closing (or its old page going on a reload). All tabs of
 * one browser share one instance.
 */
export function fakeBrowser() {
  const held = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const release = (name: string) => {
    held.delete(name);
    waiting.get(name)?.shift()?.();
  };
  // Held until the callback's promise settles; a never-settling one holds it
  // until `close`.
  const grant = (name: string, callback: (lock: unknown) => unknown) => {
    held.add(name);
    void Promise.resolve(callback({ name })).then(() => release(name));
  };
  const locks: TabLocks = {
    request(name, options, callback) {
      if (!held.has(name)) {
        grant(name, callback);
        return Promise.resolve();
      }
      if (options.ifAvailable) return Promise.resolve(callback(null));
      const signal = options.signal;
      return new Promise((resolve, reject) => {
        const queue = waiting.get(name) ?? [];
        const go = () => {
          grant(name, callback);
          resolve(undefined);
        };
        queue.push(go);
        waiting.set(name, queue);
        signal?.addEventListener('abort', () => {
          const i = queue.indexOf(go);
          if (i < 0) return; // already granted
          queue.splice(i, 1);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    },
    query: () => Promise.resolve({ held: [...held].map((name) => ({ name })) }),
  };
  const close = (id: string) => release(`mplusplus.tab.${id}`);
  return { locks, close };
}

/** Ids `t1`, `t2`, ... in order. */
export function ids(): () => string {
  let n = 0;
  return () => `t${++n}`;
}
