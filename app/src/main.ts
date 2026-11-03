/**
 * App entry. Builds the page shell, mounts the toolbar, global panel and
 * inspector, and wires selection, file drop and pick, and the undo/redo
 * keys. Owns `redraw()`, the single re-render entry point: it merges the
 * store's `positions` into the layout result, renders, re-wires node drag
 * and refits the viewBox. Loading a `.dgm` lays it out (`runLayout`) and
 * resets the undo history; a `.out` attaches p-values to the loaded graph.
 */
import { loadDgmFile, loadOutFile, classifyFile } from './io/load.js';
import { elkEngine } from './layout/elk.js';
import { semEngine } from './layout/sem.js';
import { registerLayoutEngine, getLayoutEngine, DEFAULT_LAYOUT_ENGINE } from './layout/index.js';
import {
  setupSvg,
  renderCaption,
  renderGraph,
  nodeShapeLookup,
  NODE_DIMENSIONS,
  type RenderState,
  type GroupSelection,
} from './render/svg.js';
import { cancelNodeDrag, wireNodeDrag } from './render/drag.js';
import { overlayGeometry, overlayPoints, type OverlayGeometry } from './render/residual.js';
import { wireSelection } from './render/selection.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountGlobalPanel } from './ui/globalPanel.js';
import { mountInspector } from './ui/inspector.js';
import { classifyHistoryKey } from './ui/historyKeys.js';
import { countMatchedPValues } from './ui/pValueMatch.js';
import { interceptsWindowDrag, isFileDrag } from './ui/fileDrag.js';
import { describeTarget } from './ui/textEntry.js';
import { contentViewBox, formatViewBox, placeCaption, widenToFit } from './ui/viewBox.js';
import { modelCaptions } from './model/caption.js';
import { historySlice, useStore } from './state/store.js';
import {
  clearSession,
  loadSession,
  restoreSession,
  saveSession,
  toSession,
  type SavedSession,
  type SessionStorage,
} from './state/autosave.js';
import { endActiveGesture, isGestureActive, onGestureEnd } from './state/gesture.js';
import { redoHistory, undoHistory } from './state/history.js';
import type { ModelGraph } from './model/graph.js';
import type { LayoutResult, NodeLayout } from './layout/index.js';
import type { Selection } from 'd3-selection';

registerLayoutEngine(semEngine);
registerLayoutEngine(elkEngine);

/**
 * The browser's storage for autosave, or null where it is unavailable
 * (disabled, or blocked for a page opened from `file://`).
 */
const storage: SessionStorage | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();
/** The last autosaved diagram, read before the toolbar mounts so its engine is the one shown. */
const saved = storage ? loadSession(storage) : null;

/** Engine for the next layout; the toolbar's picker changes it. */
let engineName =
  saved && getLayoutEngine(saved.engine) ? saved.engine : DEFAULT_LAYOUT_ENGINE;
/** The loaded `.dgm`, kept so autosave can store its text. */
let current: { fileName: string; dgmText: string } | null = null;
/** Set by Discard, so no save lands between clearing the slot and the reload. */
let discarding = false;

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app element missing from index.html');

app.innerHTML = `
  <header class="app-header">
    <h1>mplusplus</h1>
    <div id="toolbar"></div>
  </header>
  <div id="global-panel"></div>
  <div id="dropzone" class="dropzone">
    <p>Drop a <code>.dgm</code> or <code>.out</code> file here, or click to choose.</p>
    <input type="file" id="filepicker" accept=".dgm,.out" />
  </div>
  <div id="toast"></div>
  <div id="notice" class="notice" hidden>
    <span id="notice-text"></span>
    <button type="button" id="notice-discard" class="btn">Discard</button>
    <button type="button" id="notice-close" class="btn" title="Hide this notice">Hide</button>
  </div>
  <main class="main-area">
    <div class="canvas-wrap">
      <svg id="canvas" width="1200" height="800"></svg>
    </div>
    <aside id="inspector"></aside>
  </main>
`;

const dropzone = document.querySelector<HTMLDivElement>('#dropzone')!;
const picker = document.querySelector<HTMLInputElement>('#filepicker')!;
const svg = document.querySelector<SVGSVGElement>('#canvas')!;
const toolbarHost = document.querySelector<HTMLDivElement>('#toolbar')!;
const globalHost = document.querySelector<HTMLDivElement>('#global-panel')!;
const inspectorHost = document.querySelector<HTMLElement>('#inspector')!;
const toastHost = document.querySelector<HTMLDivElement>('#toast')!;
const notice = document.querySelector<HTMLDivElement>('#notice')!;

const { edgesG, nodesG, captionG, marqueeG, defsG } = setupSvg(svg);
fitViewBox();

function relayout(): void {
  const graph = useStore.getState().graph;
  if (!graph) return;
  runLayout(graph)
    .then(redraw)
    .catch((err: unknown) => {
      console.error(err);
      toast(`Layout failed: ${err instanceof Error ? err.message : String(err)}`, true);
    });
}

mountToolbar(toolbarHost, {
  onRedraw: redraw,
  onRelayout: relayout,
  engines: [
    { name: semEngine.name, label: 'SEM' },
    { name: elkEngine.name, label: 'ELK' },
  ],
  engine: engineName,
  // Switching engines lays the model out again, so like Re-run layout it
  // drops styles and undo history (open item in TODO.md).
  onEngineChange: (name) => {
    engineName = name;
    relayout();
  },
});

mountGlobalPanel(globalHost, { onRedraw: redraw });
mountInspector(inspectorHost, redraw);

wireSelection(svg, marqueeG, redraw);

dropzone.addEventListener('click', () => picker.click());
dropzone.addEventListener('dragover', () => dropzone.classList.add('drag-over'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

// Files may be dropped anywhere on the page. Handling dragover/drop on the
// window keeps the browser from navigating away to a dropped file or link,
// and routes every file drop (dropzone, canvas, panels) through
// `handleFile`. Which drags are taken over is `interceptsWindowDrag`: all
// of them, except a non-file drag over a text-entry field, so dragging text
// into an input keeps its default behaviour.
window.addEventListener('dragover', (e) => {
  const types = e.dataTransfer?.types;
  if (!interceptsWindowDrag(types, describeTarget(e.target))) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = isFileDrag(types) ? 'copy' : 'none';
});
window.addEventListener('drop', (e) => {
  dropzone.classList.remove('drag-over');
  const types = e.dataTransfer?.types;
  if (!interceptsWindowDrag(types, describeTarget(e.target))) return;
  e.preventDefault();
  if (!isFileDrag(types)) return;
  const file = e.dataTransfer?.files?.[0];
  if (file) void handleFile(file);
});

picker.addEventListener('change', () => {
  const file = picker.files?.[0];
  if (!file) return;
  // Clear the picker once the file is handled so choosing the same file
  // again still fires `change`.
  void handleFile(file).finally(() => {
    picker.value = '';
  });
});

window.addEventListener('keydown', (e) => {
  const action = classifyHistoryKey(e, describeTarget(e.target));
  if (action === 'none') return;
  e.preventDefault();
  // Refused (returns false) in the middle of a drag or scrub.
  if (action === 'undo' ? undoHistory() : redoHistory()) redraw();
});

// The viewBox is frozen while a gesture is active (see `fitViewBox`), so
// refit once it ends.
onGestureEnd(() => fitViewBox());

// Autosave: every store change schedules a save of the open diagram, so a
// burst of changes (a drag) writes once.
const AUTOSAVE_DELAY_MS = 400;
let saveTimer: number | undefined;
useStore.subscribe(() => {
  if (!storage) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const s = useStore.getState();
    if (discarding || !current || !s.graph || !s.layout) return;
    const session = toSession(current.fileName, current.dgmText, engineName, s.layout, historySlice(s), new Date());
    if (!saveSession(storage, session)) console.warn('Autosave failed: browser storage refused the diagram.');
  }, AUTOSAVE_DELAY_MS);
});

document.querySelector('#notice-close')!.addEventListener('click', () => (notice.hidden = true));
document.querySelector('#notice-discard')!.addEventListener('click', () => {
  // Undo cannot bring a discarded diagram back; the reload starts empty.
  discarding = true;
  if (storage) clearSession(storage);
  window.location.reload();
});

if (saved) restore(saved);

/** Bring back the autosaved diagram, as it was, with a notice offering Discard. */
function restore(session: SavedSession): void {
  try {
    const { graph, layout, slice } = restoreSession(session);
    cancelNodeDrag();
    endActiveGesture();
    useStore.getState().loadGraph(graph, layout);
    useStore.setState(slice);
    const t = (useStore as unknown as { temporal: { getState(): { clear(): void } } }).temporal;
    t.getState().clear();
    current = { fileName: session.fileName, dgmText: session.dgmText };
    redraw();
    dropzone.classList.add('hidden');
    const when = new Date(session.savedAt).toLocaleString();
    document.querySelector('#notice-text')!.textContent = `Restored ${session.fileName} (saved ${when}).`;
    notice.hidden = false;
  } catch (err) {
    console.warn('Autosaved diagram could not be restored; discarding it.', err);
    if (storage) clearSession(storage);
  }
}

async function handleFile(file: File): Promise<void> {
  const kind = classifyFile(file);
  try {
    if (kind === 'dgm') {
      const { graph, text } = await loadDgmFile(file);
      await runLayout(graph);
      current = { fileName: file.name, dgmText: text };
      notice.hidden = true;
      redraw();
      dropzone.classList.add('hidden');
      toast(`Loaded ${file.name}`);
    } else if (kind === 'out') {
      if (!useStore.getState().graph) {
        toast('Load a .dgm file before attaching a .out file.', true);
        return;
      }
      const { pValues } = await loadOutFile(file);
      const graph = useStore.getState().graph;
      const n = graph ? countMatchedPValues(pValues, graph) : 0;
      if (n === 0) {
        toast(`No p-values in ${file.name} match an edge in this diagram.`, true);
        return;
      }
      useStore.getState().setPValues(pValues);
      redraw();
      toast(`Attached p-values from ${file.name} (${n} edges).`);
    } else {
      toast('Unknown file type. Expected .dgm or .out.', true);
    }
  } catch (err) {
    console.error(err);
    toast(`Failed to load ${file.name}: ${(err as Error).message}`, true);
  }
}

let toastTimer: number | undefined;
function toast(msg: string, error = false): void {
  toastHost.textContent = msg;
  toastHost.className = error ? 'toast error' : 'toast';
  toastHost.style.display = 'block';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastHost.style.display = 'none';
  }, 3000);
}

async function runLayout(graph: ModelGraph): Promise<void> {
  const engine = getLayoutEngine(engineName);
  if (!engine) throw new Error(`Layout engine missing: ${engineName}`);
  const result = await engine.layout(graph, {
    width: 1200,
    height: 800,
    nodeWidth: NODE_DIMENSIONS.width,
    nodeHeight: NODE_DIMENSIONS.height,
  });
  // A node drag still in progress would keep writing positions (stale ones,
  // one undo entry per move) into the new layout, and a gesture still open
  // would push a snapshot of the old diagram when it ends. Cancel the drag,
  // which ends its own gesture, then end any other gesture, whoever owns
  // it. Both are no-ops when nothing is active.
  cancelNodeDrag();
  endActiveGesture();
  useStore.getState().loadGraph(graph, result);
  const t = (useStore as unknown as { temporal: { getState(): { clear(): void } } }).temporal;
  t.getState().clear();
}

function redraw(): void {
  const s = useStore.getState();
  if (!s.graph || !s.layout) return;
  const merged = mergeLayout(s.layout, s.positions);
  const state: RenderState = {
    graph: s.graph,
    layout: merged,
    global: s.global,
    edgeStyles: s.edgeStyles,
    nodeStyles: s.nodeStyles,
    pValues: s.pValues,
    nodeSelection: s.selection,
    edgeSelection: s.edgeSelection,
  };
  const overlay = renderGraph(edgesG, nodesG, defsG as Selection<SVGDefsElement, unknown, null, undefined>, state);
  wireNodeDrag(nodesG as GroupSelection, redraw);
  fitViewBox(overlay);
}

/**
 * Fit the canvas viewBox to the merged node positions and edge bend points
 * plus padding. It is left alone while a gesture is active: changing the
 * viewBox mid-drag would change the pointer-to-diagram mapping under the
 * pointer, so the dragged node would drift from the grab point. `onGestureEnd` refits afterwards.
 * `overlay` is the residual and curve geometry just drawn, when the caller
 * has it; otherwise it is worked out here.
 */
function fitViewBox(overlay?: OverlayGeometry): void {
  if (isGestureActive()) return;
  const s = useStore.getState();
  const merged = s.layout ? mergeLayout(s.layout, s.positions) : null;
  const boxes = merged?.nodes ?? [];
  const points = merged?.edges.flatMap((e) => e.bend ?? []) ?? [];
  if (merged && s.graph) {
    const shapeOf = nodeShapeLookup(s.graph, s.nodeStyles);
    points.push(...overlayPoints(overlay ?? overlayGeometry(merged, s.graph.edges, shapeOf)));
  }
  const content = contentViewBox(boxes, { points });
  const captions = s.graph ? modelCaptions(s.graph.source) : [];
  const placed = placeCaption(content, captions.length);
  const textWidth = renderCaption(captionG, captions, placed);
  svg.setAttribute('viewBox', formatViewBox(widenToFit(placed.viewBox, placed.at.x, textWidth)));
}

function mergeLayout(
  layout: LayoutResult,
  positions: Record<string, { x: number; y: number; width: number; height: number }>,
): LayoutResult {
  const nodes: NodeLayout[] = layout.nodes.map((n) => {
    const p = positions[n.id];
    return p ? { ...n, ...p } : n;
  });
  return { ...layout, nodes };
}
