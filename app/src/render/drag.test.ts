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
import { wireNodeDrag } from './drag.js';
import type { GroupSelection } from './svg.js';
import { useStore, type NodePosition } from '../state/store.js';
import { endActiveGesture, isGestureActive } from '../state/gesture.js';

const temporal = (useStore as unknown as {
  temporal: { getState(): { pastStates: unknown[]; undo(): void; clear(): void } };
}).temporal;

const pos = (x: number, y = 0): NodePosition => ({ x, y, width: 120, height: 56 });

/** A `g.node` stand-in: listeners, `data-id`, a style sink, a parent. */
class FakeNode extends EventTarget {
  readonly style = { setProperty(): void {}, removeProperty(): void {} };
  readonly parentNode = {};
  /** d3-drag binds touch listeners only where this exists (or maxTouchPoints). */
  ontouchstart = null;
  constructor(private readonly id: string) {
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

describe('drag start positions are read at the threshold, not the press (Q2)', () => {
  it('does not re-apply a position that undo restored between press and threshold', () => {
    useStore.getState().setNodePositions({ a: pos(50) });
    wireNodeDrag(group, redraw);
    touch(node, 'touchstart', 3, 100, 100);
    temporal.getState().undo(); // a back to 10, before the drag has moved anything
    expect(useStore.getState().positions.a.x).toBe(10);
    touch(node, 'touchmove', 3, 120, 100);
    expect(useStore.getState().positions.a.x).toBe(30);
    touch(node, 'touchend', 3, 120, 100);
    expect(isGestureActive()).toBe(false);
  });
});
