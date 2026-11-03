/**
 * Autosave decisions: which slot this tab saves to, what it restores or
 * offers on start, when a save is skipped, and which old slots are
 * deleted. Each tab saves only to its own slot (`slotKey(tabId)`), so tabs
 * never overwrite each other (Amelia, 2026-11-03: a slot per tab, with the
 * logic in one tested module instead of `main.ts`). Storage, the lock API,
 * the tab channel and the clock are passed in, so every case runs in tests
 * with fakes; `main.ts` only wires it to the store, the timer and the page.
 *
 * The rule (Amelia, 2026-11-03): a reload brings back the tab's own work;
 * anything else is offered, never taken.
 * - On start a tab restores its own slot, if it has one (a reload keeps
 *   the tab's id). Otherwise it restores nothing and offers the most
 *   recently saved slot of a closed tab.
 * - Opening an offer loads that diagram into this tab without writing
 *   anything; the tab's first edit saves it to its own slot. The original
 *   is left alone.
 * - This tab writes and deletes only its own slot, except the cleanup:
 *   on start, closed tabs' slots beyond the `MAX_SLOTS` most recent are
 *   deleted, and when storage refuses a save, closed tabs' slots are
 *   deleted oldest first to make room. Both ask the lock API which tabs
 *   are open at that moment, and delete nothing when it cannot tell.
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
import { claimTabId, openTabIds, type TabChannel, type TabLocks } from './autosaveTabs.js';

/** Closed tabs' slots kept; older ones are deleted on start (Amelia, 2026-11-03). */
export const MAX_SLOTS = 5;
/** Left by the shared-slot builds of 2026-11-03; deleted on start. */
const STRAY_KEYS = [`${LEGACY_KEY}.tab`, 'mplusplus.autosave.discarded'];

export interface AutosaveDeps {
  storage: SessionStorage;
  /** The Web Locks API, or undefined where it is missing. */
  locks: TabLocks | undefined;
  /** A channel to the other tabs, used where the lock API is missing. */
  channel?: TabChannel;
  /** This tab's `sessionStorage`, or null where it is unavailable. */
  tabStore: Pick<Storage, 'getItem' | 'setItem'> | null;
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

export interface StartResult {
  /** This tab's own saved diagram, to restore (after a reload). */
  restore: SavedSession | null;
  /** Otherwise, the most recent closed tab's diagram, to offer. */
  offer: SavedSession | null;
}

export class AutosaveController {
  private tabId: string | null = null;
  private lastSaved: SaveState | null = null;
  /** Bumped by every write attempt and restore, so a make-room retry can tell it has been overtaken. */
  private generation = 0;
  private discarded = false;

  constructor(private readonly deps: AutosaveDeps) {}

  /** This tab's id once `start` has claimed it. */
  get id(): string | null {
    return this.tabId;
  }

  /** Claim this tab's id, tidy old slots, and say what to restore or offer. */
  async start(): Promise<StartResult> {
    const { storage, locks, channel, tabStore, newId } = this.deps;
    try {
      this.tabId = await claimTabId(locks, tabStore, newId, { channel });
    } catch {
      this.tabId = newId();
    }
    for (const k of STRAY_KEYS) clearSession(storage, k);
    const open = await openTabIds(locks);
    if (open) this.evict(open);

    const slots = listSlots(storage);
    const own = slots.find((s) => s.tabId === this.tabId);
    if (own) return { restore: own.session, offer: null };
    // Without the lock API any tab may be open; offering is harmless, since
    // opening an offer writes nothing to the slot it came from.
    const closed = slots.find((s) => s.tabId === null || !open || !open.has(s.tabId));
    return { restore: null, offer: closed?.session ?? null };
  }

  /**
   * Save `input` to this tab's slot, unless nothing changed since the last
   * save, restore or opened offer. A refused save clears this tab's slot
   * (`saveSession`) and returns 'refused'; `makeRoomAndSave` can then try
   * again after freeing space.
   */
  save(input: SaveInput): SaveResult {
    if (!this.tabId || this.discarded) return 'not-started';
    if (this.lastSaved && sameSaveState(this.lastSaved, input.state)) return 'unchanged';
    this.generation++;
    const ok = saveSession(this.deps.storage, slotKey(this.tabId), this.toSession(input));
    this.lastSaved = ok ? input.state : null;
    return ok ? 'saved' : 'refused';
  }

  /**
   * After a refused save of `input`: delete closed tabs' slots, oldest
   * first, asking the lock API which tabs are open now, and retry after
   * each. Deletes nothing, and returns 'refused', when it cannot tell which
   * are open, or when deleting every closed slot could not make room for
   * this one. Returns 'unchanged' without touching storage when a newer
   * save or a Discard happened while it waited, so it never writes stale
   * work over newer work or brings a discarded diagram back.
   */
  async makeRoomAndSave(input: SaveInput): Promise<SaveResult> {
    if (!this.tabId || this.discarded) return 'not-started';
    const generation = this.generation;
    const open = await openTabIds(this.deps.locks);
    if (this.discarded || generation !== this.generation) return 'unchanged';
    if (!open) return 'refused';
    const key = slotKey(this.tabId);
    const json = JSON.stringify(this.toSession(input));
    const closed = listSlots(this.deps.storage)
      .reverse()
      .filter((s) => isClosed(s, open, this.tabId!));
    const freeable = closed.reduce((n, s) => n + (this.deps.storage.getItem(s.key)?.length ?? 0), 0);
    if (freeable < json.length) return 'refused';
    for (const s of closed) {
      clearSession(this.deps.storage, s.key);
      try {
        this.deps.storage.setItem(key, json);
        this.lastSaved = input.state;
        return 'saved';
      } catch {
        // Still too full; free the next one.
      }
    }
    return 'refused';
  }

  /** Record that `state` needs no save yet: it was restored, or opened from an offer. */
  markSaved(state: SaveState | null): void {
    this.generation++;
    this.lastSaved = state;
  }

  /** Delete this tab's slot, and save nothing more in this page (it reloads next). No other slot is touched. */
  discard(): void {
    this.discarded = true;
    if (this.tabId) clearSession(this.deps.storage, slotKey(this.tabId));
    this.lastSaved = null;
  }

  private toSession(input: SaveInput): SavedSession {
    const { state } = input;
    return toSession(input.fileName, input.dgmText, state.engine, state.layout, state.slice, this.deps.now(), this.tabId!);
  }

  /** Keep this tab's slot, open tabs' slots and the `MAX_SLOTS` most recent others; delete the rest. */
  private evict(open: Set<string>): void {
    let kept = 0;
    for (const s of listSlots(this.deps.storage)) {
      if (!isClosed(s, open, this.tabId!)) continue;
      if (kept < MAX_SLOTS) kept++;
      else clearSession(this.deps.storage, s.key);
    }
  }
}

/** True for a slot no open tab owns: the legacy shared slot, or one whose tab is not in `open` and is not `me`. */
function isClosed(s: StoredSlot, open: Set<string>, me: string): boolean {
  return s.tabId !== me && (s.tabId === null || !open.has(s.tabId));
}
