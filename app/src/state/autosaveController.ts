/**
 * Autosave decisions: which slot this tab saves to, which session it
 * restores on start, when a save is skipped, and which old slots are
 * deleted. Each tab saves only to its own slot (`slotKey(tabId)`), so tabs
 * never overwrite each other (Amelia, 2026-11-03: a slot per tab, with the
 * logic in one tested module instead of `main.ts`). Storage, the lock API
 * and the clock are passed in, so every case runs in tests with fakes;
 * `main.ts` only wires it to the store, the timer and the page.
 *
 * On start a tab restores, in order:
 * 1. its own slot (a reload keeps the tab's id);
 * 2. otherwise the most recently saved slot whose tab is closed, copied to
 *    this tab's key, so a diagram from a closed tab comes back in the next
 *    new tab. The original stays: a tab the browser unloaded to save
 *    memory looks closed, and gets its own slot back when revisited;
 * 3. otherwise nothing.
 * Slots of open tabs are never restored or deleted by another tab. Nothing
 * is deleted except by Discard (this tab's slot, and the slot it was copied
 * from), by the cap of `MAX_SLOTS` closed tabs' slots, or to make room when
 * storage refuses a save.
 */
import {
  clearSession,
  LEGACY_KEY,
  listSlots,
  sameSaveState,
  saveSession,
  slotKey,
  toSession,
  type SavedSession,
  type SaveState,
  type SessionStorage,
  type StoredSlot,
} from './autosave.js';
import { claimTabId, openTabIds, type TabLocks } from './autosaveTabs.js';

/** Slots kept besides those of open tabs; older ones are deleted on start (Amelia, 2026-11-03). */
export const MAX_SLOTS = 5;
/** `sessionStorage` flag set by Discard, so the reload after it restores nothing. */
export const DISCARDED_KEY = 'mplusplus.autosave.discarded';
/** Left by the shared-slot builds of 2026-11-03; deleted on start. */
const STRAY_KEYS = [`${LEGACY_KEY}.tab`];

export interface AutosaveDeps {
  storage: SessionStorage;
  /** The Web Locks API, or undefined where it is missing. */
  locks: TabLocks | undefined;
  /** This tab's `sessionStorage`, or null where it is unavailable. */
  tabStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  newId(): string;
  now(): Date;
}

/** What a save writes. */
export interface SaveInput {
  fileName: string;
  dgmText: string;
  state: SaveState;
}

export type SaveResult = 'saved' | 'unchanged' | 'refused' | 'not-started';

export class AutosaveController {
  private tabId: string | null = null;
  private lastSaved: SaveState | null = null;
  private closedAtStart = new Set<string>();
  /** The closed tab's slot this tab's diagram was copied from on start, if any. */
  private copiedFrom: string | null = null;

  constructor(private readonly deps: AutosaveDeps) {}

  /** This tab's id once `start` has claimed it. */
  get id(): string | null {
    return this.tabId;
  }

  /**
   * Claim this tab's id, delete slots beyond `MAX_SLOTS`, and return the
   * session to restore (see the module comment), or null.
   */
  async start(): Promise<SavedSession | null> {
    const { storage, locks, tabStore, newId } = this.deps;
    try {
      this.tabId = await claimTabId(locks, tabStore, newId);
    } catch {
      this.tabId = newId();
    }
    const me = this.tabId;
    for (const k of STRAY_KEYS) clearSession(storage, k);
    const open = await openTabIds(locks);
    const discarded = this.takeDiscardedFlag();

    const slots = listSlots(storage);
    const own = slots.find((s) => s.tabId === me) ?? null;
    let restore: SavedSession | null = null;
    if (!discarded) {
      const closed = slots.find((s) => s.tabId === null || !open.has(s.tabId));
      if (own) restore = own.session;
      else if (closed) restore = this.takeOver(closed);
    }
    this.evict(open);
    return restore;
  }

  /**
   * Save `input` to this tab's slot, unless nothing changed since the last
   * save or restore. When storage refuses it, the oldest slots of closed
   * tabs are deleted and the save tried once more; if it is still refused,
   * this tab's slot is cleared (`saveSession`).
   */
  save(input: SaveInput): SaveResult {
    if (!this.tabId) return 'not-started';
    if (this.lastSaved && sameSaveState(this.lastSaved, input.state)) return 'unchanged';
    const { storage, now } = this.deps;
    const { state } = input;
    const session = toSession(input.fileName, input.dgmText, state.engine, state.layout, state.slice, now(), this.tabId);
    const key = slotKey(this.tabId);
    let ok = saveSession(storage, key, session);
    // Make room by deleting closed tabs' slots, oldest first, one at a time.
    for (const s of ok ? [] : this.closedSlotsOldestFirst()) {
      clearSession(storage, s.key);
      if ((ok = saveSession(storage, key, session))) break;
    }
    this.lastSaved = ok ? state : null;
    return ok ? 'saved' : 'refused';
  }

  /** Record that the slot already holds `state` (after a restore), so saving it again is skipped. */
  markSaved(state: SaveState | null): void {
    this.lastSaved = state;
  }

  /**
   * Delete this tab's slot, and the closed tab's slot it was copied from,
   * so the discarded diagram does not come back in the next new tab; and
   * make the next start of this tab restore nothing.
   */
  discard(): void {
    if (this.tabId) clearSession(this.deps.storage, slotKey(this.tabId));
    if (this.copiedFrom) clearSession(this.deps.storage, this.copiedFrom);
    this.copiedFrom = null;
    this.lastSaved = null;
    try {
      this.deps.tabStore?.setItem(DISCARDED_KEY, '1');
    } catch {
      // Without sessionStorage the reload may restore a closed tab's diagram.
    }
  }

  private takeDiscardedFlag(): boolean {
    const store = this.deps.tabStore;
    if (!store) return false;
    try {
      const set = store.getItem(DISCARDED_KEY) !== null;
      store.removeItem(DISCARDED_KEY);
      return set;
    } catch {
      return false;
    }
  }

  /**
   * Copy a closed tab's `slot` to this tab's key and return its session.
   * The legacy shared slot, which no tab can come back for, is moved
   * instead.
   */
  private takeOver(slot: StoredSlot): SavedSession {
    const session = { ...slot.session, tabId: this.tabId! };
    const copied = saveSession(this.deps.storage, slotKey(this.tabId!), session);
    if (copied && slot.key === LEGACY_KEY) clearSession(this.deps.storage, slot.key);
    else this.copiedFrom = slot.key;
    return session;
  }

  /**
   * Keep this tab's slot, open tabs' slots and the `MAX_SLOTS` most recent
   * others; delete the rest. Remembers the kept slots of closed tabs, the
   * only ones a refused save may later delete.
   */
  private evict(open: Set<string>): void {
    let kept = 0;
    this.closedAtStart = new Set();
    for (const s of listSlots(this.deps.storage)) {
      if (s.tabId === this.tabId || (s.tabId !== null && open.has(s.tabId))) continue;
      if (kept < MAX_SLOTS) {
        kept++;
        this.closedAtStart.add(s.key);
      } else {
        clearSession(this.deps.storage, s.key);
      }
    }
  }

  /**
   * Slots whose tab was closed when this tab started, still present, oldest
   * first. Whether a tab is open cannot be asked during a synchronous save,
   * so only slots known closed at start are offered for deletion: a tab
   * opened since then, or reopened, keeps its slot.
   */
  private closedSlotsOldestFirst(): StoredSlot[] {
    return listSlots(this.deps.storage)
      .filter((s) => this.closedAtStart.has(s.key))
      .reverse();
  }
}
