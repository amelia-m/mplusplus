/**
 * Header toolbar: align and distribute the selected nodes, rotate or flip
 * the selection or the whole diagram and grow a selection of factors to
 * their measurement blocks (`render/arrange.ts`), undo and redo (through
 * `state/history.ts`) and re-run the layout.
 */
import { alignSelected, distributeSelected, type AlignMode, type DistributeMode } from '../render/align.js';
import { arrangeSelected, selectBlocks } from '../render/arrange.js';
import type { TransformOp } from '../layout/transform.js';
import { redoHistory, undoHistory } from '../state/history.js';

export interface ToolbarHooks {
  onRedraw(): void;
  onRelayout(): void;
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
    arrangeSelected(op);
    hooks.onRedraw();
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
      titled(make('Rotate ↺', 'btn', arrange('rotate-ccw')), 'Rotate 90° counter-clockwise (the selection, or the whole diagram when nothing is selected)'),
      titled(make('Rotate ↻', 'btn', arrange('rotate-cw')), 'Rotate 90° clockwise (the selection, or the whole diagram when nothing is selected)'),
      titled(make('Flip ↔', 'btn', arrange('flip-h')), 'Flip left to right (the selection, or the whole diagram)'),
      titled(make('Flip ↕', 'btn', arrange('flip-v')), 'Flip top to bottom (the selection, or the whole diagram)'),
      titled(make('Select block', 'btn', () => {
        selectBlocks();
        hooks.onRedraw();
      }), "Add each selected factor's indicators to the selection"),
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
}
