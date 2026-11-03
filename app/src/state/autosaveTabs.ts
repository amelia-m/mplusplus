/**
 * Which tab autosaves. All tabs share the one autosave slot, so two tabs
 * saving would overwrite each other (Amelia, 2026-11-03: one tab owns
 * autosave, "y"). Each tab has an id, kept in `sessionStorage` so a reload
 * keeps it, and holds a browser lock named after it while it is open (Web
 * Locks API). The slot records the id of the tab that wrote it, and a tab
 * may write the slot, or restore from it, only when it wrote it, nobody
 * did, or the writer is no longer open. So a reloaded tab gets its own
 * diagram back even with other tabs open, and another tab takes over only
 * once the writer has closed and it has a change of its own to save.
 * Where the lock API is missing or fails, no tab can tell whether another
 * is open, and the last writer wins, as before.
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
 * True when this tab may write the slot last written by tab `writer`, or
 * restore from it: no writer recorded, this tab is the writer, or the
 * writer is no longer open.
 */
export function ownsSlot(writer: string | undefined, me: string, writerOpen: boolean): boolean {
  return writer === undefined || writer === me || !writerOpen;
}

/**
 * True when this tab may write the slot as it unloads. Nothing can be
 * awaited then, so whether another writer is still open cannot be asked:
 * only a slot this tab wrote, or one nobody did, is written.
 */
export function mayWriteOnPagehide(writer: string | undefined, me: string): boolean {
  return writer === undefined || writer === me;
}

/**
 * Take lock `name` and hold it until the tab closes: at once if it is
 * free, or, given `waitMs`, as soon as it is released within that time.
 * False when another tab still holds it; true when the API fails, since
 * nothing can be told apart then.
 */
function holdLock(locks: TabLocks, name: string, waitMs = 0): Promise<boolean> {
  return new Promise((resolve) => {
    const take = (lock: unknown) => {
      resolve(lock !== null);
      return lock !== null ? new Promise(() => {}) : undefined;
    };
    // A plain timer and AbortController, not AbortSignal.timeout, which
    // older browsers with Web Locks (Safari before 16) lack.
    const abort = new AbortController();
    const timer = waitMs > 0 ? setTimeout(() => abort.abort(), waitMs) : undefined;
    const options = waitMs > 0 ? { signal: abort.signal } : { ifAvailable: true };
    locks
      .request(name, options, take)
      .catch((err: unknown) => {
        // A wait that was given up means the lock is still held elsewhere.
        resolve(!abort.signal.aborted && (err as { name?: unknown } | null)?.name !== 'AbortError');
      })
      .finally(() => clearTimeout(timer));
  });
}

/**
 * Settles once the tab with id `id` has closed: its lock was released and,
 * `graceMs` later, has not been taken again, which a reload of that tab
 * would do (`claimTabId` waits up to `RELOAD_LOCK_WAIT_MS` for it). Never
 * settles where the lock API is missing or fails; no tab is ever seen as
 * open there, so nothing waits for one.
 */
export async function whenTabCloses(locks: TabLocks | undefined, id: string, graceMs = 2 * RELOAD_LOCK_WAIT_MS): Promise<void> {
  if (!locks) return new Promise(() => {});
  for (;;) {
    try {
      // Granted only once the holder has gone; released again at once.
      await locks.request(tabLock(id), {}, () => undefined);
    } catch {
      return new Promise(() => {});
    }
    await new Promise((r) => setTimeout(r, graceMs));
    if (!(await isTabOpen(locks, id))) return;
  }
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

/** True when the tab with id `id` is open; false when it is not, or nothing can tell. */
export async function isTabOpen(locks: TabLocks | undefined, id: string): Promise<boolean> {
  if (!locks) return false;
  try {
    const { held } = await locks.query();
    return (held ?? []).some((l) => l.name === tabLock(id));
  } catch {
    return false;
  }
}
