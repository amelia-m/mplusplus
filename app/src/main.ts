/**
 * App entry. Builds the page shell, mounts the toolbar, global panel and
 * inspector, and wires selection, file drop and pick, and the undo/redo
 * keys. Owns `redraw()`, the single re-render entry point: it merges the
 * store's `positions` into the layout result, renders, re-wires node drag
 * and shows the view (`updateView`: zoom and pan, fitted on load, restore,
 * Re-run layout and the Fit button only). Loading a `.dgm` lays it out (`runLayout`) and
 * resets the undo history; a `.out` attaches p-values to the loaded graph,
 * or, with no diagram loaded, opens as a diagram on its own.
 */
import { loadDgmFile, loadOutFile, classifyFile } from './io/load.js';
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
import { curveLabelHalfWidth, overlayGeometry, overlayPoints, type OverlayGeometry } from './render/residual.js';
import { DEFAULT_EDGE_STYLE, displayNamePairs } from './render/styles.js';
import { wireSelection } from './render/selection.js';
import { elementSize, ViewController, wireZoom } from './render/zoom.js';
import { mountToolbar } from './ui/toolbar.js';
import { mountGlobalPanel } from './ui/globalPanel.js';
import { mountInspector } from './ui/inspector.js';
import { classifyHistoryKey } from './ui/historyKeys.js';
import { countMatchedPValues, countNamedEdges, countPValueEdges, mplusTitle, outAttachNote } from './ui/pValueMatch.js';
import { interceptsWindowDrag, isFileDrag } from './ui/fileDrag.js';
import { describeTarget } from './ui/textEntry.js';
import { DEMOS, type Demo } from './ui/demos.js';
import { contentViewBox, formatViewBox, placeCaption, widenToFit } from './ui/viewBox.js';
import { modelCaptions, OUT_ORIGIN_NOTE } from './model/caption.js';
import { readOutModel } from './parser/outModel.js';
import { openExportDialog } from './ui/exportDialog.js';
import { buildGraph } from './model/graph.js';
import { historySlice, useStore, type HistorySlice } from './state/store.js';
import {
  restoredPositions,
  restoreSession,
  type SavedSession,
  type SaveState,
  type SessionStorage,
  type SourceKind,
} from './state/autosave.js';
import { AutosaveController } from './state/autosaveController.js';
import type { TabChannel } from './state/autosaveTabs.js';
import { endActiveGesture, isGestureActive, onGestureEnd } from './state/gesture.js';
import { redoHistory, undoHistory } from './state/history.js';
import type { ModelGraph } from './model/graph.js';
import type { LayoutResult } from './layout/index.js';
import { mergeLayout } from './layout/merge.js';
import type { Selection } from 'd3-selection';

registerLayoutEngine(semEngine);

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
/** This tab's `sessionStorage`, which keeps its autosave id across reloads, or null. */
const tabStore: Storage | null = (() => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
})();
/** A `BroadcastChannel` to this origin's other tabs, or undefined where the browser lacks it. */
function tabChannel(): TabChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
  const channel = new BroadcastChannel('mplusplus.tabs');
  return {
    post: (m) => channel.postMessage(m),
    listen: (handler) => channel.addEventListener('message', (e) => handler(e.data)),
  };
}
/** Autosave (`state/autosaveController.ts`), or null where browser storage is unavailable. */
const autosave = storage
  ? new AutosaveController({
      storage,
      locks: navigator.locks,
      tabStore,
      channel: tabChannel(),
      newId: () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2),
      now: () => new Date(),
    })
  : null;

/**
 * Engine for every layout. Only `sem` ships (Amelia, 2026-11-03: ELK
 * dropped), so this is a constant; a restored diagram laid out by another
 * engine is laid out again (see `restore`).
 */
const engineName = DEFAULT_LAYOUT_ENGINE;
/** The loaded file (a `.dgm`, or a `.out` opened on its own), kept so autosave can store its text. */
let current: { fileName: string; dgmText: string; sourceKind: SourceKind } | null = null;
/** Set by Discard, so no save lands between clearing the slot and the reload. */
let discarding = false;
/** Set when storage refused a save, so the warning is shown once per diagram. */
let saveRefused = false;

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
    <details id="demos" class="demos">
      <summary>Or click here to select a demo example</summary>
      <p class="demos-note">Invented models fitted by Mplus to simulated data. Open one, or download its files to try a drop. The models and data are public domain (CC0); the header and copyright notice Mplus writes into each <code>.out</code> are Muthén &amp; Muthén's.</p>
      <ul id="demo-list"></ul>
    </details>
  </div>
  <div id="toast"></div>
  <div id="notice" class="notice" hidden>
    <span id="notice-text"></span>
    <button type="button" id="notice-open" class="btn" hidden>Open</button>
    <button type="button" id="notice-discard" class="btn">Discard</button>
    <button type="button" id="notice-close" class="btn" title="Hide this notice">Hide</button>
  </div>
  <main class="main-area">
    <div class="canvas-wrap">
      <svg id="canvas" width="1200" height="800"></svg>
    </div>
    <aside id="inspector"></aside>
  </main>
  <footer class="app-credit">
    Designed by Amelia Miramonti and implemented with Claude Code (Anthropic).
    mplusplus is an independent project: it is not official, and it is not affiliated with, endorsed by or maintained by Muthén &amp; Muthén, the makers of Mplus.
  </footer>
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
/**
 * The canvas view: zoom, pan and when to fit (`render/zoom.ts`). It is a
 * view, not the diagram, so it is neither undoable nor autosaved; a restored
 * diagram is fitted.
 */
const view = new ViewController();
/**
 * The residual and curve geometry last drawn by `redraw`, so the content box
 * is worked out from what is on the canvas, the same way on every call.
 */
let lastOverlay: OverlayGeometry | undefined;
/**
 * The canvas's size in CSS pixels, kept by the ResizeObserver below so a
 * redraw (every move of a drag) does not force a layout to measure it.
 */
let canvasSize = elementSize(svg);

updateView();

/** Lay the loaded model out again (Re-run layout). */
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
  onFit: () => {
    view.requestFit();
    updateView();
  },
  onMessage: (text) => toast(text),
  onExport: (kind) => {
    const s = useStore.getState();
    const source =
      current && s.graph
        ? {
            svg: canvasForExport(),
            fileName: current.fileName,
            fileText: current.dgmText,
            coefficientMode: s.global.coefMode,
            // The weight captions only: the .out-origin note is drawn on the
            // diagram, which the export carries, but it is not a weight.
            weights: modelCaptions(s.graph.source).filter((c) => c !== OUT_ORIGIN_NOTE),
            // A `.out` opened on its own is its own p-value source too.
            outAttached: current.sourceKind === 'out' || Object.keys(s.pValues).length > 0,
            displayNames: displayNamePairs(s.graph.nodes, s.nodeStyles),
          }
        : null;
    openExportDialog(kind, source, (text) => toast(text));
  },
  // Open recent: the kept diagrams, opened as the notice's Open does.
  // Without browser storage nothing is kept, and the menu is not shown.
  recent: autosave
    ? {
        list: () => autosave.listRecent(),
        open: (entry) => void openKept(entry.session),
        remove: (key) => autosave.remove(key),
        onMessage: (text) => toast(text),
      }
    : undefined,
});

mountGlobalPanel(globalHost, { onRedraw: redraw });
mountInspector(inspectorHost, redraw);

const selection = wireSelection(svg, marqueeG, redraw);
wireZoom(svg, view, {
  apply: (vb) => svg.setAttribute('viewBox', formatViewBox(vb)),
  // Two fingers pan and zoom: a selection box or node drag stops. Positions
  // a drag already wrote stay, and are drawn, so nothing needs redrawing.
  stopOneFingerGestures: () => {
    selection.cancelMarquee();
    cancelNodeDrag();
  },
});
// A resized canvas keeps its zoom and center (`resizeView`).
// A resize during a drag or a slider scrub waits for it to end: a refit then
// would move the diagram under the pointer. Redraws in the meantime keep the
// old size, so the view stays put.
let resizePending = false;
new ResizeObserver(() => {
  if (isGestureActive()) {
    resizePending = true;
    return;
  }
  canvasSize = elementSize(svg);
  updateView();
}).observe(svg);
onGestureEnd(() => {
  if (!resizePending) return;
  resizePending = false;
  canvasSize = elementSize(svg);
  updateView();
});

dropzone.addEventListener('click', (e) => {
  // A click in the demo list opens a demo or a download, not the file picker.
  if ((e.target as Element).closest('#demos')) return;
  picker.click();
});

mountDemos(document.querySelector<HTMLUListElement>('#demo-list')!);

/** One row per demo: an Open button and a download link per file. */
function mountDemos(list: HTMLUListElement): void {
  for (const demo of DEMOS) {
    const item = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn';
    open.textContent = demo.label;
    open.addEventListener('click', () => void openDemo(demo));
    item.append(open);
    for (const f of demo.files) {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([f.text], { type: 'text/plain' }));
      link.download = f.name;
      link.textContent = f.name;
      item.append(' ', link);
    }
    list.append(item);
  }
}

/** Set while a demo loads, so a second click cannot interleave its files with the first's. */
let demoLoading = false;

/**
 * Open a demo as if its files were dropped one after another, `.dgm` first,
 * stopping at the first that fails so its message stays on screen. The
 * whole demo is one starting point: Undo does not take its p-values off.
 */
async function openDemo(demo: Demo): Promise<void> {
  if (demoLoading) return;
  demoLoading = true;
  try {
    // One queued job for the whole demo, so nothing else (a dropped file, an
    // Open recent entry) can land between its `.dgm` and its `.out`.
    await enqueueLoad(async () => {
      for (const f of demo.files) {
        if (!(await loadFile(new File([f.text], f.name, { type: 'text/plain' }), { undoable: false }))) return;
      }
      clearHistory();
    });
  } finally {
    demoLoading = false;
  }
}
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
  // The export dialog holds a copy of the canvas taken when it opened; an
  // undo behind it would export a state no longer on screen.
  if (document.querySelector('dialog[open]')) return;
  const action = classifyHistoryKey(e, describeTarget(e.target));
  if (action === 'none') return;
  e.preventDefault();
  // Refused (returns false) in the middle of a drag or scrub.
  if (action === 'undo' ? undoHistory() : redoHistory()) redraw();
});

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

/** Save the open diagram to this tab's slot (`state/autosaveController.ts`). */
function saveNow(): void {
  window.clearTimeout(saveTimer);
  const state = saveState();
  if (!autosave || discarding || !current || !state) return;
  const input = { fileName: current.fileName, dgmText: current.dgmText, sourceKind: current.sourceKind, state };
  // Storage is full: free closed tabs' slots and try again, once per
  // diagram, then say so if it still fails. A save that goes through
  // re-arms the retry for a later refusal.
  const result = autosave.save(input);
  if (result === 'saved') saveRefused = false;
  if (result !== 'refused' || saveRefused) return;
  void autosave.makeRoomAndSave(input).then((result) => {
    if (result === 'refused' && !saveRefused) {
      toast('Autosave is off for this diagram: browser storage refused it.', true);
      saveRefused = true;
    }
  });
}

useStore.subscribe(() => {
  if (!autosave) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, AUTOSAVE_DELAY_MS);
});
// A reload or tab close within the delay would otherwise lose the last change.
window.addEventListener('pagehide', saveNow);

document.querySelector('#notice-close')!.addEventListener('click', () => (notice.hidden = true));
document.querySelector('#notice-discard')!.addEventListener('click', discardAndReload);

/** Clear this tab's slot and reload empty. Undo cannot bring the diagram back. */
function discardAndReload(): void {
  discarding = true;
  window.clearTimeout(saveTimer);
  autosave?.discard();
  window.location.reload();
}

/** The closed tab's diagram on offer (the Open button), if any. */
let offered: SavedSession | null = null;

document.querySelector('#notice-open')!.addEventListener('click', () => {
  if (offered) void openKept(offered);
});

/**
 * Open a kept diagram (the notice's Open, or an Open recent entry) in this
 * tab. It waits in the file load queue (`handleFile`), so it lands after any
 * file already queued and before any queued after it: a `.out` dropped
 * meanwhile attaches to whichever diagram is open when its turn comes, and
 * neither can install in the middle of the other.
 */
function openKept(session: SavedSession): Promise<void> {
  return enqueueLoad(() => restore(session, 'offered'));
}

/**
 * Bumped by each install of a loaded file or a saved diagram, so a restore
 * still being laid out can tell that a newer diagram has landed and give way.
 */
let installs = 0;

/**
 * Restore this tab's own diagram after a reload, or offer a closed tab's,
 * unless the user loaded a file first (that file is then saved).
 */
async function startAutosave(controller: AutosaveController): Promise<void> {
  const { restore: own, offer } = await controller.start();
  // A file loaded, or a kept diagram opened (Open recent works as soon as
  // the tab has its id), while the controller started wins over the restore.
  if (installs > 0) {
    saveNow();
  } else if (own) {
    await restore(own, 'own');
  } else if (offer) {
    offered = offer;
    const when = new Date(offer.savedAt).toLocaleString();
    showNotice(`A diagram from a closed tab is available: ${offer.fileName} (saved ${when}).`, 'offer');
  }
}

if (autosave) void startAutosave(autosave);

/**
 * Show `text` in the notice bar, with Discard for a restored diagram or Open
 * for an offered one; `warning` styles it as a warning (a `.out` that may be
 * from another model).
 */
function showNotice(text: string, kind: 'restored' | 'offer' | 'opened', warning = false): void {
  notice.classList.toggle('warning', warning);
  document.querySelector('#notice-text')!.textContent = text;
  document.querySelector<HTMLButtonElement>('#notice-discard')!.hidden = kind !== 'restored';
  document.querySelector<HTMLButtonElement>('#notice-open')!.hidden = kind !== 'offer';
  notice.hidden = false;
}

/**
 * Load a saved diagram: this tab's own (after a reload) or one opened from
 * an offer. It comes back as it was, or laid out again when the saved
 * layout no longer fits the graph or came from an engine that no longer
 * ships (ELK, dropped 2026-11-03, whose bend points `sem` never makes). Nothing is
 * written until the next edit, so an opened offer that is never edited
 * leaves no copy. If this tab's own diagram fails to restore, its saved
 * copy is kept and autosave stops for this page, so a half-restored
 * diagram is never saved over it, with Discard offered; a failed offer
 * only says so.
 */
async function restore(session: SavedSession, source: 'own' | 'offered'): Promise<void> {
  const seq = installs;
  try {
    const { graph, layout, slice } = restoreSession(session, engineName);
    const placed = layout ?? (await computeLayout(graph));
    // A file the user loaded, or a diagram opened, while this was laid out wins.
    if (installs !== seq) return;
    installGraph(graph, placed, slice);
    installs++;
    redraw();
    current = { fileName: session.fileName, dgmText: session.dgmText, sourceKind: session.sourceKind ?? 'dgm' };
    offered = null;
    saveRefused = false;
    // After this tab's own diagram failed to restore, autosave stopped to
    // keep its slot; a diagram opened since is saved under a new id, as a
    // loaded file is (openDiagram).
    if (autosave?.isStopped && !discarding) await autosave.startFresh();
    autosave?.markSaved(saveState());
    dropzone.classList.add('hidden');
    const when = new Date(session.savedAt).toLocaleString();
    const how = layout ? '' : ' Laid out again: the saved layout could not be used as it was.';
    if (source === 'own') showNotice(`Restored ${session.fileName} (saved ${when}).${how}`, 'restored');
    else showNotice(`Opened ${session.fileName} from a closed tab (saved ${when}).${how}`, 'opened');
  } catch (err) {
    console.warn('Autosaved diagram could not be restored.', err);
    // A file the user loaded while this was laid out wins here too: it stays
    // on screen and is saved to a new slot, so the slot that failed is kept,
    // as when the file comes after the failure (handleFile). A failed open
    // of a kept diagram leaves this tab's slot as it is.
    if (installs !== seq) {
      if (source === 'own' && !discarding) {
        autosave?.stop();
        await autosave?.startFresh();
        saveNow();
      }
      return;
    }
    if (source === 'own') {
      // Keep the saved copy (a later version may restore it) and stop saving
      // the half-restored state over it; Discard still removes it.
      autosave?.stop();
      showNotice(
        `Could not restore ${session.fileName}. The saved copy is kept, and autosave is off in this tab until it reloads.`,
        'restored',
      );
    } else {
      toast(`Could not open ${session.fileName}.`, true);
    }
  }
}

/** The load in progress, which the next file waits for. */
let loadQueue: Promise<unknown> = Promise.resolve();

/**
 * Load a dropped, picked or demo file; true when it was loaded or attached.
 * Files load one at a time, in the order they came: a `.out` dropped while a
 * `.dgm` is still being laid out then attaches to it instead of opening on
 * its own, and two `.dgm` files cannot finish out of order.
 */
function handleFile(file: File): Promise<boolean> {
  return enqueueLoad(() => loadFile(file));
}

/** Run `job` after every load queued before it, and before any queued after it. */
function enqueueLoad<T>(job: () => Promise<T>): Promise<T> {
  const run = loadQueue.then(job);
  loadQueue = run.catch(() => undefined);
  return run;
}

/** `undoable: false` for a demo, whose history is reset once it has loaded. */
async function loadFile(file: File, opts: { undoable?: boolean } = {}): Promise<boolean> {
  const kind = classifyFile(file);
  try {
    if (kind === 'dgm') {
      const { graph, text } = await loadDgmFile(file);
      await openDiagram(file.name, text, 'dgm', graph);
      notice.hidden = true;
      return true;
    } else if (kind === 'out') {
      if (!useStore.getState().graph) {
        // Nothing loaded: open the .out as a diagram on its own.
        const { text, pValues } = await loadOutFile(file);
        const model = readOutModel(text);
        if (!model.ok) {
          toast(`Cannot open ${file.name}: ${model.message}`, true);
          return false;
        }
        await openDiagram(file.name, text, 'out', buildGraph(model.dgm), { pValues });
        const noEcho = model.echo ? '' : ' It has no input echo (NOECHO), so labels are not shown.';
        showNotice(`${OUT_ORIGIN_NOTE}.${noEcho}`, 'opened');
        return true;
      }
      const { text, pValues } = await loadOutFile(file);
      const graph = useStore.getState().graph;
      const n = graph ? countMatchedPValues(pValues, graph) : 0;
      if (n === 0) {
        toast(`No p-values in ${file.name} match an edge in this diagram.`, true);
        return false;
      }
      // One undo entry (pValues is in the history), so "Undo removes them"
      // holds; none when the same values were already there.
      const before = useStore.getState().pValues;
      useStore.getState().setPValues(pValues);
      const changed = useStore.getState().pValues !== before;
      redraw();
      const note = outAttachNote({
        outName: file.name,
        diagramName: current?.fileName ?? 'this diagram',
        matched: n,
        named: graph ? countNamedEdges(pValues, graph) : n,
        undoable: opts.undoable,
        attachable: graph ? countPValueEdges(graph) : n,
        outTitle: mplusTitle(text, 'out'),
        diagramTitle: current ? mplusTitle(current.dgmText, current.sourceKind) : null,
        changed,
      });
      showNotice(note.text, 'opened', note.warning);
      return true;
    }
    toast('Unknown file type. Expected .dgm or .out.', true);
    return false;
  } catch (err) {
    console.error(err);
    toast(`Failed to load ${file.name}: ${(err as Error).message}`, true);
    return false;
  }
}

/**
 * Make a newly loaded file the open diagram: lay it out and install it with
 * `slice` (a `.out`'s p-values) as the undo baseline. Autosave then saves it
 * with its text and source kind (`current`).
 */
async function openDiagram(
  fileName: string,
  text: string,
  sourceKind: SourceKind,
  graph: ModelGraph,
  slice?: Partial<HistorySlice>,
): Promise<void> {
  const layout = await computeLayout(graph);
  // Set in the same step as the install, so a restore still in
  // progress sees it and gives way; a load that failed never sets it.
  installGraph(graph, layout, slice);
  installs++;
  current = { fileName, dgmText: text, sourceKind };
  saveRefused = false;
  offered = null;
  // After a restore that failed, autosave stopped to keep the broken
  // slot; a new file gets a new slot, so it is saved and the old one kept.
  if (autosave?.isStopped && !discarding) await autosave.startFresh();
  redraw();
  dropzone.classList.add('hidden');
  toast(`Loaded ${fileName}`);
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
  installGraph(graph, await computeLayout(graph));
}

function computeLayout(graph: ModelGraph): Promise<LayoutResult> {
  const engine = getLayoutEngine(engineName);
  if (!engine) return Promise.reject(new Error(`Layout engine missing: ${engineName}`));
  return engine.layout(graph, {
    width: 1200,
    height: 800,
    nodeWidth: NODE_DIMENSIONS.width,
    nodeHeight: NODE_DIMENSIONS.height,
  });
}

/**
 * Make `graph`, placed by `layout`, the open diagram, with `slice` (a
 * restored diagram's positions and styles) when given, and start a fresh
 * undo history.
 */
function installGraph(graph: ModelGraph, layout: LayoutResult, slice?: Partial<HistorySlice>): void {
  // A node drag still in progress would keep writing positions (stale ones,
  // one undo entry per move) into the new layout, and a gesture still open
  // would push a snapshot of the old diagram when it ends. Cancel the drag,
  // which ends its own gesture, then end any other gesture, whoever owns
  // it. Both are no-ops when nothing is active.
  cancelNodeDrag();
  endActiveGesture();
  useStore.getState().loadGraph(graph, layout);
  if (slice) {
    const positions = slice.positions && restoredPositions(useStore.getState().positions, slice.positions);
    useStore.setState(positions ? { ...slice, positions } : slice);
  }
  clearHistory();
}

/** Make the current state the undo baseline. */
function clearHistory(): void {
  const t = (useStore as unknown as { temporal: { getState(): { clear(): void } } }).temporal;
  t.getState().clear();
}

function redraw(): void {
  const s = useStore.getState();
  if (!s.graph || !s.layout) return;
  const merged = mergeLayout(s.layout, s);
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
  updateView(overlay);
}

/**
 * Work out the content box (merged node positions, edge bend points and the
 * residual and curve geometry drawn, plus padding and the caption under it)
 * and show the view: `view` (`render/zoom.ts`) fits it on load, restore and
 * Re-run layout (a new layout object) and after the Fit button, and keeps
 * the user's zoom and pan after every other change, so an edit never moves
 * the view. `overlay` is the geometry `redraw` just drew; without it the last
 * drawn geometry is used.
 */
function updateView(overlay?: OverlayGeometry): void {
  const s = useStore.getState();
  const merged = s.layout ? mergeLayout(s.layout, s) : null;
  const boxes = merged?.nodes ?? [];
  const points = merged?.edges.flatMap((e) => e.bend ?? []) ?? [];
  if (overlay) lastOverlay = overlay;
  if (merged && s.graph) {
    const shapeOf = nodeShapeLookup(s.graph, s.nodeStyles);
    const labelHalf = curveLabelHalfWidth({ ...s.global, fontSize: DEFAULT_EDGE_STYLE.labelFontSize });
    lastOverlay ??= overlayGeometry(merged, s.graph.edges, shapeOf);
    points.push(...overlayPoints(lastOverlay, labelHalf));
  }
  const content = contentViewBox(boxes, { points });
  const captions = s.graph ? modelCaptions(s.graph.source) : [];
  const placed = placeCaption(content, captions.length);
  const textWidth = renderCaption(captionG, captions, placed);
  const whole = widenToFit(placed.viewBox, placed.at.x, textWidth);
  svg.setAttribute('viewBox', formatViewBox(view.update(s.layout, whole, canvasSize)));
}

/**
 * The canvas for an export: a copy whose viewBox is the whole diagram (the
 * content box of the last redraw), not the zoomed or panned view.
 */
function canvasForExport(): SVGSVGElement {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const whole = view.contentBox;
  if (whole) copy.setAttribute('viewBox', formatViewBox(whole));
  return copy;
}

