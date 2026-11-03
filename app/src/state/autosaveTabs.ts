/**
 * Tab identity for autosave. Each tab saves to its own slot, named after
 * the tab's id (Amelia, 2026-11-03: a slot per tab, after one shared slot
 * kept losing diagrams between tabs). The id is kept in `sessionStorage`,
 * so a reload keeps it and gets its own slot back, and the tab holds a
 * browser lock named after it while it is open (Web Locks API), so other
 * tabs can tell whether a slot's tab is still open. Where the lock API is
 * missing or fails, nothing can tell, and callers treat every tab as
 * possibly open.
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
 * 'busy' when another tab still holds it; 'failed' when the API itself
 * fails (a rejection that is not the wait being given up).
 */
function holdLock(locks: TabLocks, name: string, waitMs = 0): Promise<'held' | 'busy' | 'failed'> {
  return new Promise((resolve) => {
    // A plain timer and AbortController, not AbortSignal.timeout, which
    // older browsers with Web Locks (Safari before 16) lack.
    const abort = new AbortController();
    const timer = waitMs > 0 ? setTimeout(() => abort.abort(), waitMs) : undefined;
    const take = (lock: unknown) => {
      clearTimeout(timer);
      resolve(lock !== null ? 'held' : 'busy');
      return lock !== null ? new Promise(() => {}) : undefined;
    };
    const options = waitMs > 0 ? { signal: abort.signal } : { ifAvailable: true };
    locks.request(name, options, take).catch((err: unknown) => {
      clearTimeout(timer);
      const givenUp = abort.signal.aborted || (err as { name?: unknown } | null)?.name === 'AbortError';
      resolve(givenUp ? 'busy' : 'failed');
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
 * A channel between this origin's tabs (a `BroadcastChannel` in the app),
 * used to spot a duplicated tab where the lock API is missing.
 */
export interface TabChannel {
  post(message: unknown): void;
  listen(handler: (message: unknown) => void): void;
}

/** How long a tab without the lock API waits for another tab to say it holds the same id. */
export const ID_QUESTION_WAIT_MS = 150;

interface IdMessage {
  kind: 'who-has' | 'have';
  id: string;
}
const isIdMessage = (m: unknown): m is IdMessage =>
  typeof m === 'object' && m !== null && typeof (m as IdMessage).id === 'string';

export interface ClaimOptions {
  /** How long a reload waits for its old page's lock (`RELOAD_LOCK_WAIT_MS`). */
  waitMs?: number;
  /** Used where the lock API is missing or fails; without it a duplicated tab keeps the original's id. */
  channel?: TabChannel;
  questionWaitMs?: number;
}

/**
 * This tab's id: the one kept in `store` from before a reload, or a new one
 * from `newId`. A duplicated tab inherits the original's `sessionStorage`
 * and must not keep that id, or both tabs would save to one slot. With the
 * lock API, the original still holds the id's lock, so the copy, after
 * waiting `waitMs` in case it is a reload instead, takes a new id. Where
 * the lock API is missing or fails, the copy asks over `channel` whether an
 * open tab has the id, and
 * takes a new one if any answers. Either way the tab then answers that
 * question for its own id.
 */
export async function claimTabId(
  locks: TabLocks | undefined,
  store: IdStore | null,
  newId: () => string,
  options: ClaimOptions = {},
): Promise<string> {
  const { waitMs = RELOAD_LOCK_WAIT_MS, channel, questionWaitMs = ID_QUESTION_WAIT_MS } = options;
  const kept = read(store);
  let id = kept ?? newId();
  let lock: 'held' | 'busy' | 'failed' = 'failed';
  if (locks) {
    lock = await holdLock(locks, tabLock(id));
    if (lock === 'busy' && kept !== null) lock = await holdLock(locks, tabLock(id), waitMs);
    if (lock === 'busy') {
      id = newId();
      lock = await holdLock(locks, tabLock(id));
    }
  }
  // Without a working lock API, ask the other tabs instead.
  if (lock === 'failed' && channel && id === kept && (await someTabHas(channel, kept, questionWaitMs))) {
    id = newId();
  }
  channel?.listen((m) => {
    if (isIdMessage(m) && m.kind === 'who-has' && m.id === id) channel.post({ kind: 'have', id });
  });
  try {
    store?.setItem(TAB_ID_KEY, id);
  } catch {
    // Without sessionStorage the id lasts until the tab reloads.
  }
  return id;
}

/** True when another tab answers, within `waitMs`, that it holds `id`. */
function someTabHas(channel: TabChannel, id: string, waitMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    channel.listen((m) => {
      if (isIdMessage(m) && m.kind === 'have' && m.id === id) answered = true;
    });
    channel.post({ kind: 'who-has', id });
    setTimeout(() => resolve(answered), waitMs);
  });
}

function read(store: IdStore | null): string | null {
  try {
    return store?.getItem(TAB_ID_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * The ids of the open tabs, or null when nothing can tell (the lock API is
 * missing or fails). Callers must treat null as "any tab may be open".
 */
export async function openTabIds(locks: TabLocks | undefined): Promise<Set<string> | null> {
  if (!locks) return null;
  try {
    const { held } = await locks.query();
    const prefix = tabLock('');
    return new Set(
      (held ?? []).flatMap((l) => (l.name?.startsWith(prefix) ? [l.name.slice(prefix.length)] : [])),
    );
  } catch {
    return null;
  }
}
