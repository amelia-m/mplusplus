/**
 * Right-side inspector. Mounts both a node-style inspector and an edge-style
 * inspector and shows whichever is relevant for the current selection. When
 * both nodes and edges are selected, both panels render stacked.
 *
 * The panels are rebuilt only when what they are about changes (the graph or
 * which nodes and edges are selected). Style, global and p-value changes
 * update the control values in place, so a live slider is never replaced
 * under the pointer. Controls show the effective style of the first selected
 * object (`inspectorValues.ts`), the same style the renderer draws, except
 * the WITH/COVAR dash and arrowhead forced in `svg.ts` (see TODO.md).
 *
 * Sliders record one undo entry per scrub (`liveSlider.ts`); every other
 * control commits one entry per change.
 */

import { useStore, type AppState } from '../state/store.js';
import { isGestureActive, onGestureEnd } from '../state/gesture.js';
import {
  FONT_FAMILIES,
  type EdgeStyle,
  type EdgeStyleOverride,
  type NodeShape,
  type NodeStyle,
  type NodeStyleOverride,
  type StrokeStyle,
  type ArrowheadStyle,
} from '../render/styles.js';
import { edgeInspectorStyle, nodeInspectorStyle } from './inspectorValues.js';
import { parseNumberInput, type NumberSpec } from './numberInput.js';
import { formatNumber, wireLiveSlider } from './liveSlider.js';

type Redraw = () => void;

/** A control row plus a setter that shows a value without firing events. */
interface Row<V> {
  el: HTMLElement;
  set(v: V): void;
}

/** Pushes the current state's values into the built controls. */
type Sync = (s: AppState) => void;

export function mountInspector(host: HTMLElement, redraw: Redraw): void {
  host.classList.add('inspector');
  let sync: Sync = () => {};
  let rebuildPending = false;

  const rebuild = (): void => {
    rebuildPending = false;
    sync = buildInspector(host, redraw);
    sync(useStore.getState());
  };

  useStore.subscribe((s, prev) => {
    const structural =
      s.graph !== prev.graph ||
      !sameSet(s.selection, prev.selection) ||
      !sameSet(s.edgeSelection, prev.edgeSelection);
    if (structural) {
      // Never swap panels out from under a live gesture; rebuild when it ends.
      if (isGestureActive()) rebuildPending = true;
      else rebuild();
      return;
    }
    if (
      !rebuildPending &&
      (s.nodeStyles !== prev.nodeStyles ||
        s.edgeStyles !== prev.edgeStyles ||
        s.global !== prev.global ||
        s.pValues !== prev.pValues)
    ) {
      sync(s);
    }
  });
  onGestureEnd(() => {
    if (rebuildPending) rebuild();
  });
  rebuild();
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Build the panels for the current selection; returns their value sync. */
function buildInspector(host: HTMLElement, redraw: Redraw): Sync {
  const { selection, edgeSelection, graph } = useStore.getState();
  host.innerHTML = '';
  if (!graph) {
    host.classList.add('empty');
    host.append(emptyMessage('Drop a .dgm file to begin.'));
    return () => {};
  }
  if (selection.size === 0 && edgeSelection.size === 0) {
    host.classList.add('empty');
    host.append(emptyMessage('Select a node or edge to edit its style.'));
    return () => {};
  }
  host.classList.remove('empty');

  const syncs: Sync[] = [];
  if (selection.size > 0) {
    const panel = buildNodePanel(Array.from(selection), redraw);
    host.append(panel.el);
    syncs.push((s) => {
      const style = nodeInspectorStyle(s);
      if (style) panel.set(style);
    });
  }
  if (edgeSelection.size > 0) {
    const panel = buildEdgePanel(Array.from(edgeSelection), redraw);
    host.append(panel.el);
    syncs.push((s) => {
      const style = edgeInspectorStyle(s);
      if (style) panel.set(style);
    });
  }
  return (s) => {
    for (const fn of syncs) fn(s);
  };
}

function emptyMessage(text: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'inspector-empty';
  p.textContent = text;
  return p;
}

const STROKE_STYLES: [StrokeStyle, string][] = [
  ['solid', 'Solid'],
  ['dashed', 'Dashed'],
  ['dotted', 'Dotted'],
];
const FONT_OPTIONS: [string, string][] = FONT_FAMILIES.map((f) => [f, f]);
const STROKE_WIDTH: NumberSpec & { step: number } = { min: 0.5, max: 10, step: 0.1 };
const FONT_SIZE: NumberSpec & { step: number } = { min: 8, max: 32, step: 1, integer: true };

/** Collects rows and a combined setter for a panel. */
function panelOf<S>(title: string, rows: Row<S>[]): Row<S> {
  const panel = makePanel(title);
  panel.append(...rows.map((r) => r.el));
  return {
    el: panel,
    set: (style) => {
      for (const r of rows) r.set(style);
    },
  };
}

/** Adapt a row of value `V` to read its value out of a whole style `S`. */
function bind<S, V>(row: Row<V>, pick: (s: S) => V): Row<S> {
  return { el: row.el, set: (s) => row.set(pick(s)) };
}

// ----------------- node panel -----------------

function buildNodePanel(ids: string[], redraw: Redraw): Row<NodeStyle> {
  const commit = (patch: NodeStyleOverride): void => {
    useStore.getState().setNodeStyles(ids, patch);
    redraw();
  };
  return panelOf<NodeStyle>(`Nodes (${ids.length})`, [
    bind(colorRow('Fill', (v) => commit({ fill: v })), (s) => s.fill),
    bind(colorRow('Stroke', (v) => commit({ stroke: v })), (s) => s.stroke),
    bind(
      sliderNumberRow('Stroke width', STROKE_WIDTH, (v) => commit({ strokeWidth: v })),
      (s) => s.strokeWidth,
    ),
    bind(
      selectRow('Stroke style', STROKE_STYLES, (v) => commit({ strokeStyle: v })),
      (s) => s.strokeStyle,
    ),
    bind(
      selectRow<NodeShape | ''>(
        'Shape',
        [
          ['', 'Default for kind'],
          ['ellipse', 'Ellipse'],
          ['rect', 'Rectangle'],
          ['rounded-rect', 'Rounded rect'],
          ['diamond', 'Diamond'],
        ],
        (v) => commit({ shape: v === '' ? null : v }),
      ),
      (s) => s.shape ?? '',
    ),
    bind(
      selectRow('Font family', FONT_OPTIONS, (v) => commit({ labelFontFamily: v })),
      (s) => s.labelFontFamily,
    ),
    bind(
      sliderNumberRow('Font size', FONT_SIZE, (v) => commit({ labelFontSize: v })),
      (s) => s.labelFontSize,
    ),
    bind(
      colorRow('Font color', (v) => commit({ labelFontColor: v })),
      (s) => s.labelFontColor,
    ),
  ]);
}

// ----------------- edge panel -----------------

function buildEdgePanel(ids: string[], redraw: Redraw): Row<EdgeStyle> {
  const commit = (patch: EdgeStyleOverride): void => {
    useStore.getState().setEdgeStyles(ids, patch);
    redraw();
  };
  return panelOf<EdgeStyle>(`Edges (${ids.length})`, [
    bind(colorRow('Stroke', (v) => commit({ stroke: v })), (s) => s.stroke),
    bind(
      sliderNumberRow('Stroke width', STROKE_WIDTH, (v) => commit({ strokeWidth: v })),
      (s) => s.strokeWidth,
    ),
    bind(
      selectRow('Stroke style', STROKE_STYLES, (v) => commit({ strokeStyle: v })),
      (s) => s.strokeStyle,
    ),
    bind(
      selectRow<ArrowheadStyle>(
        'Arrowhead',
        [
          ['default', 'Default'],
          ['open', 'Open'],
          ['none', 'None'],
        ],
        (v) => commit({ arrowhead: v }),
      ),
      (s) => s.arrowhead,
    ),
    bind(
      selectRow('Label font', FONT_OPTIONS, (v) => commit({ labelFontFamily: v })),
      (s) => s.labelFontFamily,
    ),
    bind(
      sliderNumberRow('Label font size', FONT_SIZE, (v) => commit({ labelFontSize: v })),
      (s) => s.labelFontSize,
    ),
    bind(
      colorRow('Label color', (v) => commit({ labelFontColor: v })),
      (s) => s.labelFontColor,
    ),
    bind(
      decimalsRow((v) => commit({ decimals: v })),
      (s) => s.decimals,
    ),
    bind(
      checkboxRow('Show label', (v) => commit({ labelVisible: v })),
      (s) => s.labelVisible,
    ),
  ]);
}

// ----------------- DOM helpers -----------------

function makePanel(title: string): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'inspector-panel';
  const h = document.createElement('h3');
  h.textContent = title;
  div.append(h);
  return div;
}

function row(label: string, control: HTMLElement): HTMLDivElement {
  const r = document.createElement('div');
  r.className = 'inspector-row';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  r.append(lbl, control);
  return r;
}

function colorRow(label: string, onChange: (v: string) => void): Row<string> {
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.addEventListener('change', () => onChange(inp.value));
  return {
    el: row(label, inp),
    set: (v) => {
      inp.value = v;
    },
  };
}

function selectRow<V extends string>(
  label: string,
  options: [V, string][],
  onChange: (v: V) => void,
): Row<V> {
  const sel = document.createElement('select');
  for (const [val, text] of options) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = text;
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    const match = options.find((o) => o[0] === sel.value);
    if (match) onChange(match[0]);
  });
  return {
    el: row(label, sel),
    set: (v) => {
      sel.value = v;
    },
  };
}

/**
 * A slider and a number box for one value. The slider scrubs live inside one
 * undo gesture; the number box commits once on `change`, through the shared
 * parse-and-clamp (empty or invalid input leaves the value unchanged).
 */
function sliderNumberRow(
  label: string,
  spec: NumberSpec & { step: number },
  onChange: (v: number) => void,
): Row<number> {
  const wrap = document.createElement('div');
  wrap.className = 'slider-pair';
  const slider = document.createElement('input');
  slider.type = 'range';
  const num = document.createElement('input');
  num.type = 'number';
  for (const el of [slider, num]) {
    el.min = String(spec.min);
    el.max = String(spec.max);
    el.step = String(spec.step);
  }
  /** The value currently shown (from the store or the last commit). */
  let shown = spec.min;
  const show = (v: number): void => {
    shown = v;
    slider.value = String(v);
    num.value = formatNumber(v);
  };

  wireLiveSlider(slider, spec, (v) => {
    shown = v;
    num.value = formatNumber(v);
    onChange(v);
  });
  num.addEventListener('change', () => {
    const v = parseNumberInput(num.value, spec);
    if (v === null) {
      show(shown);
      return;
    }
    show(v);
    onChange(v);
  });

  wrap.append(slider, num);
  return { el: row(label, wrap), set: show };
}

function decimalsRow(onChange: (v: number | null) => void): Row<number | null> {
  const sel = document.createElement('select');
  const optGlobal = document.createElement('option');
  optGlobal.value = '';
  optGlobal.textContent = 'Use global';
  sel.append(optGlobal);
  for (let i = 0; i <= 6; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    onChange(sel.value === '' ? null : Number(sel.value));
  });
  return {
    el: row('Decimals', sel),
    set: (v) => {
      sel.value = v == null ? '' : String(v);
    },
  };
}

function checkboxRow(label: string, onChange: (v: boolean) => void): Row<boolean> {
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => onChange(cb.checked));
  return {
    el: row(label, cb),
    set: (v) => {
      cb.checked = v;
    },
  };
}
