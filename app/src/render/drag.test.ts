/**
 * Node drag wiring (`drag.ts`) driven through the real d3-drag with touch
 * and mouse events, in Vitest's node environment. A minimal fake DOM built on Node's
 * `EventTarget` stands in for the SVG: d3-drag only needs listeners, an
 * attribute, `style` and a parent; with a parent that has no SVG or layout
 * methods, d3's `pointer()` falls back to `pageX` / `pageY`, so the test
 * controls coordinates directly.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { select } from 'd3-selection';
import { cancelNodeDrag, wireNodeDrag } from './drag.js';
import type { GroupSelection } from './svg.js';
import { useStore, type NodePosition } from '../state/store.js';
import { endActiveGesture, isGestureActive } from '../state/gesture.js';

const temporal = (useStore as unknown as {
  temporal: { getState(): { pastStates: unknown[]; undo(): void; clear(): void } };
}).temporal;

const pos = (x: number, y = 0): NodePosition => ({ x, y, width: 120, height: 56 });

/** A 2D affine matrix (screen = M * local), with what d3's `pointer()` uses. */
class FakeMatrix {
  constructor(
    readonly a: number,
    readonly b: number,
    readonly c: number,
    readonly d: number,
    readonly e: number,
    readonly f: number,
  ) {}
  inverse(): FakeMatrix {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    return new FakeMatrix(d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det);
  }
}

/**
 * The drag container (the nodes' parent). By default it has no SVG methods,
 * so d3's `pointer()` falls back to `pageX` / `pageY`. Given a screen CTM it
 * behaves like an SVG `g`: d3 maps client points through the CTM's inverse,
 * and setting a new CTM stands in for a viewBox refit.
 */
class FakeContainer {
  ctm: FakeMatrix | null = null;
  get ownerSVGElement(): unknown {
    if (!this.ctm) return undefined;
    return {
      createSVGPoint: () => ({
        x: 0,
        y: 0,
        matrixTransform(m: FakeMatrix) {
          return { x: m.a * this.x + m.c * this.y + m.e, y: m.b * this.x + m.d * this.y + m.f };
        },
      }),
    };
  }
  getScreenCTM(): FakeMatrix | null {
    return this.ctm;
  }
}

/** A `g.node` stand-in: listeners, `data-id`, a style sink, a parent. */
class FakeNode extends EventTarget {
  readonly style = { setProperty(): void {}, removeProperty(): void {} };
  /** d3-drag binds touch listeners only where this exists (or maxTouchPoints). */
  ontouchstart = null;
  constructor(
    private readonly id: string,
    readonly parentNode: FakeContainer = new FakeContainer(),
  ) {
    super();
  }
  getAttribute(name: string): string | null {
    return name === 'data-id' ? this.id : null;
  }
}

/** The `nodesG` stand-in: `selectAll('g.node')` returns the fake nodes. */
function fakeGroup(nodes: FakeNode[]): GroupSelection {
  const group = { querySelectorAll: () => nodes };
  return select(group as unknown as SVGGElement) as unknown as GroupSelection;
}

function touch(target: FakeNode, type: string, id: number, x: number, y: number): void {
  const ev = new Event(type, { cancelable: true });
  const t = { identifier: id, clientX: x, clientY: y, pageX: x, pageY: y };
  Object.defineProperty(ev, 'changedTouches', { value: [t] });
  target.dispatchEvent(ev);
}

/**
 * The window stand-in: drag.ts hooks `pointercancel` / `blur` on it, and
 * d3-drag's mouse path listens on `event.view` and toggles text selection
 * on its `document.documentElement`.
 */
const view = Object.assign(new EventTarget(), {
  document: { documentElement: { style: {} as Record<string, string> } },
});

beforeAll(() => {
  (globalThis as { window?: unknown }).window = view;
  // The behaviour is shared across tests, and after a touch ends d3-drag
  // ignores mouse presses for 500 ms (ghost clicks); fake timers let each
  // test expire that guard.
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

function mouse(target: EventTarget, type: string, x: number, y: number): void {
  const ev = new Event(type, { cancelable: true });
  for (const [k, v] of Object.entries({ clientX: x, clientY: y, pageX: x, pageY: y, button: 0, ctrlKey: false, view })) {
    Object.defineProperty(ev, k, { value: v });
  }
  target.dispatchEvent(ev);
}

let node: FakeNode;
let group: GroupSelection;
let redraws = 0;

beforeEach(() => {
  endActiveGesture();
  useStore.setState({ positions: { a: pos(10) }, selection: new Set(), edgeSelection: new Set() });
  temporal.getState().clear();
  node = new FakeNode('a');
  group = fakeGroup([node]);
  redraws = 0;
});

afterEach(() => {
  // A test that failed mid-drag must not leave its session for the next one.
  cancelNodeDrag();
  endActiveGesture();
  vi.runAllTimers();
});

/** As in `main.ts`: every redraw re-wires node drag. */
function redraw(): void {
  redraws++;
  wireNodeDrag(group, redraw);
}

describe('touch drag survives the re-wire on every redraw (Q1)', () => {
  it('keeps moving after redraw rebinds, and the end closes the gesture with one undo entry', () => {
    wireNodeDrag(group, redraw);
    touch(node, 'touchstart', 7, 100, 100);
    touch(node, 'touchmove', 7, 110, 100); // crosses the threshold, redraws
    expect(useStore.getState().positions.a.x).toBe(20);
    expect(redraws).toBeGreaterThan(0);

    touch(node, 'touchmove', 7, 150, 100); // after the rebind
    expect(useStore.getState().positions.a.x).toBe(60);

    touch(node, 'touchend', 7, 150, 100);
    expect(isGestureActive()).toBe(false);
    expect(temporal.getState().pastStates.length).toBe(1);
    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(10);
  });
});

describe('mouse drag is unchanged by the shared behaviour (Q1)', () => {
  it('moves with the grab offset across redraws and records one undo entry', () => {
    wireNodeDrag(group, redraw);
    mouse(node, 'mousedown', 100, 100);
    mouse(view, 'mousemove', 101, 100); // under the click threshold
    expect(useStore.getState().positions.a.x).toBe(10);
    mouse(view, 'mousemove', 110, 100);
    expect(useStore.getState().positions.a.x).toBe(20);
    mouse(view, 'mousemove', 140, 105);
    expect(useStore.getState().positions.a).toEqual(pos(50, 5));
    mouse(view, 'mouseup', 140, 105);
    expect(isGestureActive()).toBe(false);
    expect(temporal.getState().pastStates.length).toBe(1);
  });

  it('a click under the threshold moves nothing and adds no entry', () => {
    wireNodeDrag(group, redraw);
    mouse(node, 'mousedown', 100, 100);
    mouse(view, 'mousemove', 102, 101);
    mouse(view, 'mouseup', 102, 101);
    expect(useStore.getState().positions.a.x).toBe(10);
    expect(temporal.getState().pastStates.length).toBe(0);
    expect(isGestureActive()).toBe(false);
  });
});

describe('drag start positions and pointer origin are read at the threshold, not the press (Q2, F2.3)', () => {
  it('an undo between press and threshold neither re-applies the old position nor makes the node jump', () => {
    useStore.getState().setNodePositions({ a: pos(50) });
    wireNodeDrag(group, redraw);
    touch(node, 'touchstart', 3, 100, 100);
    temporal.getState().undo(); // a back to 10, before the drag has moved anything
    expect(useStore.getState().positions.a.x).toBe(10);
    // Moves by the full pointer travel since the press, from where it is now.
    touch(node, 'touchmove', 3, 120, 100);
    expect(useStore.getState().positions.a.x).toBe(30);
    touch(node, 'touchmove', 3, 130, 100);
    expect(useStore.getState().positions.a.x).toBe(40);
    touch(node, 'touchend', 3, 130, 100);
    expect(isGestureActive()).toBe(false);
  });

  it('a viewBox refit between press and threshold does not make the node jump (the press point was kept in the old mapping)', () => {
    const container = new FakeContainer();
    container.ctm = new FakeMatrix(1, 0, 0, 1, 0, 0); // screen = local
    node = new FakeNode('a', container);
    group = fakeGroup([node]);
    wireNodeDrag(group, redraw);
    // Press 90 px right of the node's x (10): screen 100, local 100.
    touch(node, 'touchstart', 4, 100, 100);
    // Refit before the crossing: screen = 2 * local + 30.
    container.ctm = new FakeMatrix(2, 0, 0, 2, 30, 0);
    const screenX = (localX: number): number => 2 * localX + 30;
    // In the new mapping the press point (screen 100) sits this far right
    // of the node; the drag must keep that screen offset under the pointer.
    const grabOffset = 100 - screenX(10);

    touch(node, 'touchmove', 4, 110, 100); // crossing: 10 screen px = 5 local
    expect(useStore.getState().positions.a.x).toBe(15);
    touch(node, 'touchmove', 4, 130, 100);
    expect(useStore.getState().positions.a.x).toBe(25);
    expect(130 - screenX(useStore.getState().positions.a.x)).toBe(grabOffset);
    touch(node, 'touchend', 4, 130, 100);
    expect(isGestureActive()).toBe(false);
  });
});

describe('cancelNodeDrag (F2.1)', () => {
  it('a drag cancelled at file load writes no stale positions or undo entries afterwards (a drag survived a load)', () => {
    wireNodeDrag(group, redraw);
    touch(node, 'touchstart', 5, 100, 100);
    touch(node, 'touchmove', 5, 110, 100);
    touch(node, 'touchmove', 5, 130, 100);
    expect(useStore.getState().positions.a.x).toBe(40);
    expect(isGestureActive()).toBe(true);

    cancelNodeDrag();
    expect(isGestureActive()).toBe(false);
    // What runLayout does next: load the new diagram and reset history.
    useStore.setState({ positions: { a: pos(500) } });
    temporal.getState().clear();

    touch(node, 'touchmove', 5, 160, 100);
    touch(node, 'touchmove', 5, 190, 100);
    touch(node, 'touchend', 5, 190, 100);
    expect(useStore.getState().positions.a.x).toBe(500);
    expect(temporal.getState().pastStates.length).toBe(0);
    expect(isGestureActive()).toBe(false);
  });
});
