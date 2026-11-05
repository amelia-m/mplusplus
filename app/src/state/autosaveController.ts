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
 *   are open at that moment, and delete nothing when it cannot tell. The
 *   Open recent menu's remove button (`remove`) follows the same rule, for
 *   one closed tab's slot at a time.
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
  type SourceKind,
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
  /** The source file's text (`SavedSession.dgmText`). */
  dgmText: string;
  /** What the text is; a `.dgm` when absent. */
  sourceKind?: SourceKind;
  state: SaveState;
}

export type SaveResult = 'saved' | 'unchanged' | 'refused' | 'not-started';

export interface StartResult {
  /** This tab's own saved diagram, to restore (after a reload). */
  restore: SavedSession | null;
  /** Otherwise, the most recent closed tab's diagram, to offer. */
  offer: SavedSession | null;
}

/**
 * A kept diagram, for the Open recent menu (`ui/recentMenu.ts`). `owner`
 * says whose slot it is: this tab's, a closed tab's, or `'unknown'` where
 * the lock API cannot tell whether its tab is open.
 */
export interface RecentEntry {
  key: string;
  fileName: string;
  /** ISO time of the save. */
  savedAt: string;
  owner: 'this-tab' | 'closed' | 'unknown';
  session: SavedSession;
}

/** What `remove` did: deleted the slot, refused (this tab's, an open tab's, or nothing can tell), or found no such slot. */
export type RemoveResult = 'removed' | 'refused' | 'missing';

export class AutosaveController {
  private tabId: string | null = null;
  private lastSaved: SaveState | null = null;
  /** Bumped by every write attempt and restore, so a make-room retry can tell it has been overtaken. */
  private generation = 0;
  /** Set by Discard or `stop`: this page saves nothing more. */
  private stopped = false;

  constructor(private readonly deps: AutosaveDeps) {}

  /** This tab's id once `start` has claimed it. */
  get id(): string | null {
    return this.tabId;
  }

  /** True after `stop` or Discard: nothing is saved until `startFresh`. */
  get isStopped(): boolean {
    return this.stopped;
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
    if (!this.tabId || this.stopped) return 'not-started';
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
   * are open; when deleting every closed slot still does not make room,
   * they are put back and it returns 'refused'. Returns 'unchanged' without touching storage when a newer
   * save or a Discard happened while it waited, so it never writes stale
   * work over newer work or brings a discarded diagram back.
   */
  async makeRoomAndSave(input: SaveInput): Promise<SaveResult> {
    if (!this.tabId || this.stopped) return 'not-started';
    const generation = this.generation;
    const open = await openTabIds(this.deps.locks);
    if (this.stopped || generation !== this.generation) return 'unchanged';
    if (!open) return 'refused';
    const key = slotKey(this.tabId);
    const json = JSON.stringify(this.toSession(input));
    const closed = listSlots(this.deps.storage)
      .reverse()
      .filter((s) => isClosed(s, open, this.tabId!));
    // Delete tentatively: if even all of them do not make room, put them
    // back, so a save that cannot fit costs no one their diagram.
    const removed: Array<[string, string]> = [];
    for (const s of closed) {
      const raw = this.deps.storage.getItem(s.key);
      if (raw === null) continue;
      clearSession(this.deps.storage, s.key);
      removed.push([s.key, raw]);
      try {
        this.deps.storage.setItem(key, json);
        this.lastSaved = input.state;
        return 'saved';
      } catch {
        // Still too full; free the next one.
      }
    }
    for (const [k, raw] of removed) {
      try {
        this.deps.storage.setItem(k, raw);
      } catch {
        // The space it freed is still free, so this only fails if another tab took it.
      }
    }
    return 'refused';
  }

  /** Record that `state` needs no save yet: it was restored, or opened from an offer. */
  markSaved(state: SaveState | null): void {
    this.generation++;
    this.lastSaved = state;
  }

  /**
   * Save nothing more in this page, leaving the slot as it is: after a
   * restore that failed part way, so the half-restored state on screen
   * never overwrites the saved diagram, which a fixed version of the app
   * can still restore.
   */
  stop(): void {
    this.stopped = true;
  }

  /**
   * After `stop`: save from now on under a new id, so a diagram loaded into
   * this tab is autosaved while the slot that failed to restore is kept
   * (it becomes a closed tab's slot once this tab reloads with the new id,
   * and is offered or aged out from there).
   */
  async startFresh(): Promise<void> {
    const { locks, tabStore, newId, channel } = this.deps;
    try {
      this.tabId = await claimTabId(locks, tabStore ? { getItem: () => null, setItem: (k, v) => tabStore.setItem(k, v) } : null, newId, { channel });
    } catch {
      this.tabId = newId();
    }
    this.stopped = false;
    this.lastSaved = null;
    this.generation++;
  }

  /** Delete this tab's slot, and save nothing more in this page (it reloads next). No other slot is touched. */
  discard(): void {
    this.stopped = true;
    if (this.tabId) clearSession(this.deps.storage, slotKey(this.tabId));
    this.lastSaved = null;
  }

  /**
   * The kept diagrams for the Open recent menu, most recently saved first:
   * this tab's own slot and closed tabs' slots (Amelia, 2026-11-03). Other
   * open tabs' slots are left out, as `start` leaves them out of the offer.
   * Where the lock API cannot tell which tabs are open, every other slot is
   * listed as `'unknown'`, since opening one writes nothing to it. Empty
   * before `start`.
   */
  async listRecent(): Promise<RecentEntry[]> {
    if (!this.tabId) return [];
    const open = await openTabIds(this.deps.locks);
    const me = this.tabId;
    return listSlots(this.deps.storage).flatMap((s): RecentEntry[] => {
      const owner = s.tabId === me ? 'this-tab' : !open ? 'unknown' : isClosed(s, open, me) ? 'closed' : null;
      return owner ? [{ key: s.key, fileName: s.session.fileName, savedAt: s.session.savedAt, owner, session: s.session }] : [];
    });
  }

  /**
   * Delete a closed tab's slot (the menu's remove button). Refuses this
   * tab's own slot and an open tab's, and, asking the lock API which tabs
   * are open now, deletes nothing when it cannot tell (the rule of
   * `makeRoomAndSave`).
   */
  async remove(key: string): Promise<RemoveResult> {
    if (!this.tabId || key === slotKey(this.tabId)) return 'refused';
    const open = await openTabIds(this.deps.locks);
    if (!open) return 'refused';
    const slot = listSlots(this.deps.storage).find((s) => s.key === key);
    if (!slot) return 'missing';
    if (!isClosed(slot, open, this.tabId)) return 'refused';
    clearSession(this.deps.storage, key);
    return 'removed';
  }

  private toSession(input: SaveInput): SavedSession {
    const { state } = input;
    return toSession(
      input.fileName,
      input.dgmText,
      state.engine,
      state.layout,
      state.slice,
      this.deps.now(),
      this.tabId!,
      input.sourceKind,
    );
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
