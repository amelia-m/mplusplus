/**
 * Tab identity for autosave. Each tab saves to its own slot, named after
 * the tab's id (Amelia, 2026-11-03: a slot per tab, after one shared slot
 * kept losing diagrams between tabs). The id is kept in `sessionStorage`,
 * so a reload keeps it and gets its own slot back, and the tab holds a
 * browser lock named after it while it is open (Web Locks API), so other
 * tabs can tell whether a slot's tab is still open. Where the lock API is
 * missing or fails, no tab is seen as open.
 */

/** `sessionStorage` key of this tab's id. */
export const TAB_ID_KEY = 'mplusplus.tabId';
const tabLock = (id: string): string => `mplusplus.tab.${id}`;

/** The part of `LockManager` used here, so tests can pass a fake. */
export interface TabLocks {
  request(
    name: string,
    options: { ifAvailable?: boolean; signal?: AbortSignal },
    callback: (lock: unknown) => Promise<unknown> | unknown,
  ): Promise<unknown>;
  query(): Promise<{ held?: Array<{ name?: string }> }>;
}

type IdStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Take lock `name` and hold it until the tab closes: at once if it is
 * free, or, given `waitMs`, as soon as it is released within that time.
 * False when another tab still holds it; true when the API fails, since
 * nothing can be told apart then.
 */
function holdLock(locks: TabLocks, name: string, waitMs = 0): Promise<boolean> {
  return new Promise((resolve) => {
    // A plain timer and AbortController, not AbortSignal.timeout, which
    // older browsers with Web Locks (Safari before 16) lack.
    const abort = new AbortController();
    const timer = waitMs > 0 ? setTimeout(() => abort.abort(), waitMs) : undefined;
    const take = (lock: unknown) => {
      clearTimeout(timer);
      resolve(lock !== null);
      return lock !== null ? new Promise(() => {}) : undefined;
    };
    const options = waitMs > 0 ? { signal: abort.signal } : { ifAvailable: true };
    locks.request(name, options, take).catch((err: unknown) => {
      clearTimeout(timer);
      // A wait that was given up means the lock is still held elsewhere.
      resolve(!abort.signal.aborted && (err as { name?: unknown } | null)?.name !== 'AbortError');
    });
  });
}

/**
 * How long a reloaded tab waits for the lock its previous page held. The
 * browser releases that lock asynchronously, so it can still be held for
 * a moment after the reload.
 */
export const RELOAD_LOCK_WAIT_MS = 500;

/**
 * This tab's id: the one kept in `store` from before a reload, or a new one
 * from `newId`. A duplicated tab inherits the original's `sessionStorage`;
 * the original then still holds that id's lock, so the copy, after waiting
 * `waitMs` in case it is a reload instead, takes a new id.
 */
export async function claimTabId(
  locks: TabLocks | undefined,
  store: IdStore | null,
  newId: () => string,
  waitMs = RELOAD_LOCK_WAIT_MS,
): Promise<string> {
  const kept = read(store);
  let id = kept ?? newId();
  if (locks) {
    let got = await holdLock(locks, tabLock(id));
    if (!got && kept !== null) got = await holdLock(locks, tabLock(id), waitMs);
    if (!got) {
      id = newId();
      await holdLock(locks, tabLock(id));
    }
  }
  try {
    store?.setItem(TAB_ID_KEY, id);
  } catch {
    // Without sessionStorage the id lasts until the tab reloads.
  }
  return id;
}

function read(store: IdStore | null): string | null {
  try {
    return store?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

/** The ids of the open tabs; empty when nothing can tell. */
export async function openTabIds(locks: TabLocks | undefined): Promise<Set<string>> {
  if (!locks) return new Set();
  try {
    const { held } = await locks.query();
    const prefix = tabLock('');
    return new Set(
      (held ?? []).flatMap((l) => (l.name?.startsWith(prefix) ? [l.name.slice(prefix.length)] : [])),
    );
  } catch {
    return new Set();
  }
}
