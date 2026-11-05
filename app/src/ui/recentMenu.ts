/**
 * The toolbar's Open recent menu (Amelia, 2026-11-03, "y"): the kept
 * autosaved diagrams, each with its file name, when it was saved and
 * whether it is this tab's or a closed tab's, an Open button that opens it
 * as the notice's Open does, and a Remove button for closed tabs' diagrams
 * only. Which slots are listed and which may be removed is
 * `AutosaveController.listRecent` / `remove`; what each row shows and
 * allows is `recentMenuItems`, here. The DOM part only draws rows and calls
 * the hooks. `main.ts` mounts it only when browser storage is available.
 */
import type { RecentEntry, RemoveResult } from '../state/autosaveController.js';

export const EMPTY_TEXT = 'No kept diagrams yet.';

export interface RecentItem {
  key: string;
  fileName: string;
  /** The save time, formatted. */
  when: string;
  /** Whose diagram it is, for the row. */
  ownerLabel: string;
  /**
   * False for this tab's own diagram: it is the one on screen (autosave
   * keeps it in step), so opening it does nothing and the row has no Open.
   */
  canOpen: boolean;
  /** Only a closed tab's diagram may be removed. */
  canRemove: boolean;
  entry: RecentEntry;
}

const OWNER_LABELS: Record<RecentEntry['owner'], string> = {
  'this-tab': 'this tab',
  closed: 'a closed tab',
  // The lock API is missing, so its tab may still be open.
  unknown: 'another tab',
};

/** One row per entry, in the order given (most recent first). */
export function recentMenuItems(entries: RecentEntry[], formatTime: (iso: string) => string): RecentItem[] {
  return entries.map((entry) => ({
    key: entry.key,
    fileName: entry.fileName,
    when: formatTime(entry.savedAt),
    ownerLabel: OWNER_LABELS[entry.owner],
    canOpen: entry.owner !== 'this-tab',
    canRemove: entry.owner === 'closed',
    entry,
  }));
}

/** What to tell the user after a remove, or null when the list says it. */
export function removeMessage(result: RemoveResult, fileName: string): string | null {
  if (result === 'refused') return `${fileName} was not removed: its tab may be open again.`;
  if (result === 'missing') return `${fileName} is no longer kept.`;
  return null;
}

export interface RecentMenuHooks {
  list(): Promise<RecentEntry[]>;
  /** Open the entry's diagram in this tab. */
  open(entry: RecentEntry): void;
  remove(key: string): Promise<RemoveResult>;
  /** Show a short message (a toast). */
  onMessage(text: string): void;
}

/** The menu button and its drop-down panel, to put in a toolbar group. */
export function mountRecentMenu(hooks: RecentMenuHooks): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'recent-menu';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = 'Open recent';
  button.title = 'Diagrams kept by autosave in this browser: this tab’s and closed tabs’';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'recent-menu-panel';
  panel.hidden = true;
  wrap.append(button, panel);

  const close = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  /** Bumped by each refill, so a slow list never draws over a newer one. */
  let fill = 0;
  const refill = async () => {
    const mine = ++fill;
    const items = recentMenuItems(await hooks.list(), (iso) => new Date(iso).toLocaleString());
    if (mine !== fill) return;
    panel.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recent-menu-empty';
      empty.textContent = EMPTY_TEXT;
      panel.append(empty);
      return;
    }
    const list = document.createElement('ul');
    for (const item of items) list.append(row(item));
    panel.append(list);
  };
  const row = (item: RecentItem): HTMLLIElement => {
    const li = document.createElement('li');
    const text = document.createElement('span');
    text.className = 'recent-menu-text';
    const name = document.createElement('strong');
    name.textContent = item.fileName;
    text.append(name, ` saved ${item.when}, ${item.ownerLabel}`);
    li.append(text);
    if (item.canOpen) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn';
      open.textContent = 'Open';
      open.addEventListener('click', () => {
        close();
        hooks.open(item.entry);
      });
      li.append(open);
    }
    if (item.canRemove) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn';
      remove.textContent = 'Remove';
      remove.title = 'Delete this kept diagram from the browser';
      remove.addEventListener('click', () => {
        void hooks.remove(item.key).then((result) => {
          const msg = removeMessage(result, item.fileName);
          if (msg) hooks.onMessage(msg);
          return refill();
        });
      });
      li.append(remove);
    }
    return li;
  };

  button.addEventListener('click', () => {
    if (!panel.hidden) return close();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    void refill();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !wrap.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) close();
  });
  return wrap;
}
