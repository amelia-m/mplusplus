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
    options: { ifAvailable: boolean },
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
 * Take lock `name` if it is free and hold it until the tab closes. False
 * when another tab holds it; true when the API fails, since nothing can be
 * told apart then.
 */
function holdLock(locks: TabLocks, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    locks
      .request(name, { ifAvailable: true }, (lock) => {
        resolve(lock !== null);
        return lock !== null ? new Promise(() => {}) : undefined;
      })
      .catch(() => resolve(true));
  });
}

/**
 * This tab's id: the one kept in `store` from before a reload, or a new one
 * from `newId`. A duplicated tab inherits the original's `sessionStorage`;
 * the original then still holds that id's lock, so the copy takes a new id.
 */
export async function claimTabId(locks: TabLocks | undefined, store: IdStore | null, newId: () => string): Promise<string> {
  let id = read(store) ?? newId();
  if (locks && !(await holdLock(locks, tabLock(id)))) {
    id = newId();
    await holdLock(locks, tabLock(id));
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
