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
  sameSaveState,
  toSession,
  type SavedSession,
  type SaveState,
  type SessionStorage,
} from './state/autosave.js';
import { claimAutosave } from './state/autosaveLock.js';
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
/** What the slot holds now, so a save that would write the same is skipped. */
let lastSaved: SaveState | null = null;
/** Set when storage refused a save, so the warning is shown once per diagram. */
let saveRefused = false;
/** Set once this tab owns autosave (`state/autosaveLock.ts`); until then it neither saves nor restores. */
let ownsAutosave = false;
/** Set when another tab owned autosave as this one opened. */
let waitedForAutosave = false;

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

/**
 * Lay the loaded model out again, with engine `name` when given. The engine
 * becomes the current one (the one the next autosave records) only once its
 * layout succeeds.
 */
function relayout(name = engineName): void {
  const graph = useStore.getState().graph;
  if (!graph) return;
  runLayout(graph, name)
    .then(() => {
      engineName = name;
      redraw();
    })
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
  onEngineChange: (name) => relayout(name),
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

/** The state a save would write now, or null when there is no diagram to save. */
function saveState(): SaveState | null {
  const s = useStore.getState();
  if (!current || !s.graph || !s.layout) return null;
  return { file: current, engine: engineName, layout: s.layout, slice: historySlice(s) };
}

function saveNow(): void {
  window.clearTimeout(saveTimer);
  const state = saveState();
  if (!storage || !ownsAutosave || discarding || !current || !state) return;
  if (lastSaved && sameSaveState(lastSaved, state)) return;
  const session = toSession(current.fileName, current.dgmText, state.engine, state.layout, state.slice, new Date());
  if (saveSession(storage, session)) {
    lastSaved = state;
  } else {
    lastSaved = null;
    if (!saveRefused) toast('Autosave is off for this diagram: browser storage refused it.', true);
    saveRefused = true;
  }
}

useStore.subscribe(() => {
  if (!storage) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, AUTOSAVE_DELAY_MS);
});
// A reload or tab close within the delay would otherwise lose the last change.
window.addEventListener('pagehide', saveNow);

document.querySelector('#notice-close')!.addEventListener('click', () => (notice.hidden = true));
document.querySelector('#notice-discard')!.addEventListener('click', discardAndReload);

/** Clear the slot and reload empty. Undo cannot bring the diagram back. */
function discardAndReload(): void {
  discarding = true;
  window.clearTimeout(saveTimer);
  if (storage) clearSession(storage);
  window.location.reload();
}

/** Show `text` in the notice bar, with the Discard button only for a restored diagram. */
function showNotice(text: string, discardable: boolean): void {
  document.querySelector('#notice-text')!.textContent = text;
  document.querySelector<HTMLButtonElement>('#notice-discard')!.hidden = !discardable;
  notice.hidden = false;
}

if (storage) {
  claimAutosave(
    navigator.locks,
    () => {
      ownsAutosave = true;
      if (waitedForAutosave) {
        // The owning tab closed: autosave this tab's diagram from now on.
        notice.hidden = true;
        toast('Autosave is now on in this tab.');
        saveNow();
      } else if (saved) {
        void restore(saved);
      }
    },
    () => {
      waitedForAutosave = true;
      showNotice('Autosave is on in another tab: changes in this tab are not saved until that tab closes.', false);
    },
  );
}

/**
 * Bring back the autosaved diagram with a notice offering Discard: as it
 * was, or laid out again when the saved layout no longer fits the graph.
 * If anything fails part way, the slot is discarded and the page reloads
 * empty, so a half-restored diagram is neither shown nor saved again.
 */
async function restore(session: SavedSession): Promise<void> {
  try {
    const { graph, layout, slice } = restoreSession(session);
    if (layout) {
      cancelNodeDrag();
      endActiveGesture();
      useStore.getState().loadGraph(graph, layout);
    } else {
      await runLayout(graph);
    }
    useStore.setState(slice);
    const t = (useStore as unknown as { temporal: { getState(): { clear(): void } } }).temporal;
    t.getState().clear();
    redraw();
    current = { fileName: session.fileName, dgmText: session.dgmText };
    // The slot already holds this diagram as restored; saving it again
    // unchanged would only move `savedAt` to now.
    if (layout) lastSaved = saveState();
    dropzone.classList.add('hidden');
    const when = new Date(session.savedAt).toLocaleString();
    const how = layout ? '' : ' Laid out again: the saved layout no longer fits the model.';
    showNotice(`Restored ${session.fileName} (saved ${when}).${how}`, true);
  } catch (err) {
    console.warn('Autosaved diagram could not be restored; discarding it.', err);
    discardAndReload();
  }
}

async function handleFile(file: File): Promise<void> {
  const kind = classifyFile(file);
  try {
    if (kind === 'dgm') {
      const { graph, text } = await loadDgmFile(file);
      await runLayout(graph);
      current = { fileName: file.name, dgmText: text };
      saveRefused = false;
      // The restore notice no longer applies; the not-saved warning still does.
      if (ownsAutosave) notice.hidden = true;
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

async function runLayout(graph: ModelGraph, name = engineName): Promise<void> {
  const engine = getLayoutEngine(name);
  if (!engine) throw new Error(`Layout engine missing: ${name}`);
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
