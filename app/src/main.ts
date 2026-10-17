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
import { registerLayoutEngine, getLayoutEngine } from './layout/index.js';
import {
  setupSvg,
  renderGraph,
  NODE_DIMENSIONS,
  type RenderState,
  type GroupSelection,
} from './render/svg.js';
import { wireNodeDrag } from './render/drag.js';
import { wireSelection } from './render/selection.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountGlobalPanel } from './ui/globalPanel.js';
import { mountInspector } from './ui/inspector.js';
import { classifyHistoryKey } from './ui/historyKeys.js';
import { countMatchedPValues } from './ui/pValueMatch.js';
import { isFileDrag } from './ui/fileDrag.js';
import { contentViewBox, formatViewBox } from './ui/viewBox.js';
import { useStore } from './state/store.js';
import { endActiveGesture, isGestureActive, onGestureEnd } from './state/gesture.js';
import { redoHistory, undoHistory } from './state/history.js';
import type { ModelGraph } from './model/graph.js';
import type { LayoutResult, NodeLayout } from './layout/index.js';
import type { Selection } from 'd3-selection';

registerLayoutEngine(elkEngine);

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

const { edgesG, nodesG, marqueeG, defsG } = setupSvg(svg);
fitViewBox();

mountToolbar(toolbarHost, {
  onRedraw: redraw,
  onRelayout: () => {
    const graph = useStore.getState().graph;
    if (!graph) return;
    runLayout(graph)
      .then(redraw)
      .catch((err: unknown) => {
        console.error(err);
        toast(`Layout failed: ${err instanceof Error ? err.message : String(err)}`, true);
      });
  },
});

mountGlobalPanel(globalHost, { onRedraw: redraw });
mountInspector(inspectorHost, redraw);

wireSelection(svg, marqueeG, redraw);

dropzone.addEventListener('click', () => picker.click());
dropzone.addEventListener('dragover', () => dropzone.classList.add('drag-over'));
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

// Files may be dropped anywhere on the page. Handling dragover/drop on the
// window keeps the browser from navigating away to the dropped file, and
// routes every drop (dropzone, canvas, panels) through `handleFile`. Only
// drags that carry files are taken over, so dragging text into an input
// keeps its default behaviour.
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (e) => {
  dropzone.classList.remove('drag-over');
  if (!isFileDrag(e.dataTransfer?.types)) return;
  e.preventDefault();
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
  const el = e.target instanceof HTMLElement ? e.target : null;
  const target = el && {
    tagName: el.tagName,
    isContentEditable: el.isContentEditable,
    type: el instanceof HTMLInputElement ? el.type : undefined,
  };
  const action = classifyHistoryKey(e, target);
  if (action === 'none') return;
  e.preventDefault();
  // Refused (returns false) in the middle of a drag or scrub.
  if (action === 'undo' ? undoHistory() : redoHistory()) redraw();
});

// The viewBox is frozen while a gesture is active (see `fitViewBox`), so
// refit once it ends.
onGestureEnd(fitViewBox);

async function handleFile(file: File): Promise<void> {
  const kind = classifyFile(file);
  try {
    if (kind === 'dgm') {
      const { graph } = await loadDgmFile(file);
      await runLayout(graph);
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
  const engine = getLayoutEngine('elk-layered');
  if (!engine) throw new Error('Layout engine missing');
  const result = await engine.layout(graph, {
    width: 1200,
    height: 800,
    nodeWidth: NODE_DIMENSIONS.width,
    nodeHeight: NODE_DIMENSIONS.height,
  });
  // A gesture still open at load would push a snapshot of the old diagram
  // when it ends. End it first, whoever owns it; a no-op when none is active.
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
  renderGraph(edgesG, nodesG, defsG as Selection<SVGDefsElement, unknown, null, undefined>, state);
  wireNodeDrag(nodesG as GroupSelection, redraw);
  fitViewBox();
}

/**
 * Fit the canvas viewBox to the merged node positions and edge bend points
 * plus padding. It is left alone while a gesture is active: changing the
 * viewBox mid-drag would change the pointer-to-diagram mapping under the
 * pointer, so the dragged node would drift from the grab point. `onGestureEnd` refits afterwards.
 */
function fitViewBox(): void {
  if (isGestureActive()) return;
  const s = useStore.getState();
  const merged = s.layout ? mergeLayout(s.layout, s.positions) : null;
  const boxes = merged?.nodes ?? [];
  const points = merged?.edges.flatMap((e) => e.bend ?? []) ?? [];
  svg.setAttribute('viewBox', formatViewBox(contentViewBox(boxes, { points })));
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
