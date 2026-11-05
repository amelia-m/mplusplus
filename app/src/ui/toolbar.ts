/**
 * Header toolbar: open a recent autosaved diagram (`ui/recentMenu.ts`,
 * when the `recent` hooks are given), align and distribute the selected nodes, rotate or flip
 * the selection or the whole diagram and grow a selection of factors to
 * their measurement blocks (`render/arrange.ts`), undo and redo (through
 * `state/history.ts`), re-run the layout, fit the view, export (`render/export.ts`, when
 * the `onExport` hook is given) and switch the page theme.
 */
import { alignSelected, distributeSelected, type AlignMode, type DistributeMode } from '../render/align.js';
import { arrangeSelected, selectBlocks } from '../render/arrange.js';
import type { TransformOp } from '../layout/transform.js';
import type { ExportKind } from '../render/export.js';
import { redoHistory, undoHistory } from '../state/history.js';
import { nextTheme, parseTheme, themeLabel, THEME_KEY, type ThemeChoice } from './theme.js';
import { mountRecentMenu, type RecentMenuHooks } from './recentMenu.js';

const SELECT_BLOCK_MESSAGES = {
  'no-selection': 'Select a factor first: Select block adds what it measures.',
  'no-factor': 'Select a factor (an ellipse): Select block adds what it measures.',
  complete: 'The selected factors’ blocks are already selected.',
} as const;

export interface ToolbarHooks {
  onRedraw(): void;
  onRelayout(): void;
  /** Fit the whole diagram in the canvas (the View group's Fit button). */
  onFit(): void;
  /** Show a short message (a toast). */
  onMessage(text: string): void;
  /**
   * Open the export dialog for `kind` (`ui/exportDialog.ts`). Without it the
   * Export group is not shown.
   */
  onExport?(kind: ExportKind): void;
  /**
   * The Open recent menu's hooks (`ui/recentMenu.ts`). Without them (no
   * browser storage, so nothing is kept) the Recent group is not shown.
   */
  recent?: RecentMenuHooks;
}

export function mountToolbar(host: HTMLElement, hooks: ToolbarHooks): void {
  host.innerHTML = '';
  host.classList.add('toolbar');

  const make = (label: string, cls: string, fn: () => void): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = cls;
    btn.type = 'button';
    btn.addEventListener('click', fn);
    return btn;
  };

  const align = (mode: AlignMode) => () => {
    alignSelected(mode);
    hooks.onRedraw();
  };
  const arrange = (op: TransformOp) => () => {
    if (arrangeSelected(op)) hooks.onRedraw();
    else hooks.onMessage('Finish the drag first, then rotate or flip.');
  };
  const titled = (btn: HTMLButtonElement, title: string): HTMLButtonElement => {
    btn.title = title;
    return btn;
  };
  const distribute = (mode: DistributeMode) => () => {
    distributeSelected(mode);
    hooks.onRedraw();
  };

  const group = (title: string, ...children: HTMLElement[]): HTMLDivElement => {
    const wrap = document.createElement('div');
    wrap.className = 'toolbar-group';
    const lbl = document.createElement('span');
    lbl.className = 'toolbar-group-label';
    lbl.textContent = title;
    wrap.append(lbl, ...children);
    return wrap;
  };

  if (hooks.recent) host.append(group('Recent', mountRecentMenu(hooks.recent)));
  host.append(
    group(
      'Align',
      make('Left', 'btn', align('left')),
      make('Right', 'btn', align('right')),
      make('Top', 'btn', align('top')),
      make('Bottom', 'btn', align('bottom')),
      make('CenterX', 'btn', align('centerX')),
      make('CenterY', 'btn', align('centerY')),
    ),
    group(
      'Distribute',
      make('Horizontal', 'btn', distribute('horizontal')),
      make('Vertical', 'btn', distribute('vertical')),
    ),
    group(
      'Arrange',
      titled(make('Rotate ↺', 'btn', arrange('rotate-ccw')), 'Rotate 90° counter-clockwise (the selected boxes, else the ends of the selected edges, else the whole diagram)'),
      titled(make('Rotate ↻', 'btn', arrange('rotate-cw')), 'Rotate 90° clockwise (the selected boxes, else the ends of the selected edges, else the whole diagram)'),
      titled(make('Flip ↔', 'btn', arrange('flip-h')), 'Flip left to right (the selected boxes, else the ends of the selected edges, else the whole diagram)'),
      titled(make('Flip ↕', 'btn', arrange('flip-v')), 'Flip top to bottom (the selected boxes, else the ends of the selected edges, else the whole diagram)'),
      titled(make('Select block', 'btn', () => {
        const result = selectBlocks();
        if (result === 'added') hooks.onRedraw();
        else hooks.onMessage(SELECT_BLOCK_MESSAGES[result]);
      }), 'Add everything the selected factors measure (indicators, and first-order factors of a second-order one) to the selection'),
    ),
    group(
      'History',
      make('Undo', 'btn', () => {
        if (undoHistory()) hooks.onRedraw();
      }),
      make('Redo', 'btn', () => {
        if (redoHistory()) hooks.onRedraw();
      }),
    ),
    group('Layout', make('Re-run layout', 'btn', () => hooks.onRelayout())),
  );
  const onExport = hooks.onExport;
  if (onExport) {
    host.append(
      group(
        'Export',
        titled(make('SVG', 'btn', () => onExport('svg')), 'Download the diagram as SVG, with where it came from'),
        titled(make('PNG', 'btn', () => onExport('png')), 'Download the diagram as PNG at 2x, with where it came from'),
        titled(make('PDF', 'btn', () => onExport('pdf')), 'Print the diagram alone; choose Save as PDF in the print dialog'),
      ),
    );
  }
  host.append(
    group(
      'View',
      titled(
        make('Fit', 'btn', () => hooks.onFit()),
        'Show the whole diagram. Scroll to pan, Ctrl+scroll or pinch to zoom, middle-drag or two fingers to pan.',
      ),
      themeButton(make),
    ),
  );
}

/** Reads and remembers the choice; storage can be missing or refuse (private windows). */
function themeButton(make: (label: string, cls: string, fn: () => void) => HTMLButtonElement): HTMLButtonElement {
  let choice: ThemeChoice = 'auto';
  try {
    choice = parseTheme(window.localStorage.getItem(THEME_KEY));
  } catch {
    // keep auto
  }
  const apply = () => {
    if (choice === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = choice;
    btn.textContent = themeLabel(choice);
  };
  const btn = make('', 'btn', () => {
    choice = nextTheme(choice);
    try {
      window.localStorage.setItem(THEME_KEY, choice);
    } catch {
      // works for this page only
    }
    apply();
  });
  btn.title = 'Page colors: follow the system (Auto), Light or Dark. The diagram stays on a white sheet.';
  apply();
  return btn;
}
