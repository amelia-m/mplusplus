import { describe, expect, it } from 'vitest';
import {
  applyWheel,
  clampScale,
  fitView,
  MAX_SCALE,
  MIN_SCALE,
  panBy,
  pinchView,
  resizeView,
  screenToDiagram,
  ViewController,
  viewToViewBox,
  wheelAction,
  zoomAt,
  type View,
} from './zoom.js';

const size = { width: 800, height: 600 };
const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

describe('screenToDiagram and viewToViewBox', () => {
  const view: View = { x: 100, y: -50, scale: 2 };

  it('maps a local pixel through the view, and the viewBox draws the same mapping', () => {
    expect(screenToDiagram(view, { x: 40, y: 60 })).toEqual({ x: 120, y: -20 });
    const vb = viewToViewBox(view, size);
    expect(vb).toEqual({ x: 100, y: -50, width: 400, height: 300 });
    // The element's bottom-right pixel is the viewBox's bottom-right corner.
    expect(screenToDiagram(view, { x: 800, y: 600 })).toEqual({ x: vb.x + vb.width, y: vb.y + vb.height });
  });
});

describe('zoomAt', () => {
  it('keeps the diagram point under the pointer in place', () => {
    const view: View = { x: 10, y: 20, scale: 1.5 };
    const at = { x: 300, y: 125 };
    const before = screenToDiagram(view, at);
    const after = zoomAt(view, 2, at);
    expect(after.scale).toBe(3);
    const moved = screenToDiagram(after, at);
    expect(moved.x).toBeCloseTo(before.x, 10);
    expect(moved.y).toBeCloseTo(before.y, 10);
  });

  it('stops at the zoom limits', () => {
    expect(zoomAt({ x: 0, y: 0, scale: 6 }, 4, { x: 0, y: 0 }).scale).toBe(MAX_SCALE);
    expect(zoomAt({ x: 0, y: 0, scale: 0.2 }, 0.1, { x: 0, y: 0 }).scale).toBe(MIN_SCALE);
  });
});

describe('clampScale', () => {
  it('lets a view fitted below the minimum stay or zoom in, never further out', () => {
    expect(clampScale(0.02, 0.05)).toBe(0.05);
    expect(clampScale(0.07, 0.05)).toBe(0.07);
    expect(clampScale(20, 1)).toBe(MAX_SCALE);
  });
});

describe('fitView', () => {
  it('centers the content and shows all of it', () => {
    const content = { x: -40, y: -40, width: 400, height: 600 };
    const view = fitView(content, size);
    expect(view.scale).toBe(1); // height-limited: 600 / 600
    const vb = viewToViewBox(view, size);
    expect(vb.y).toBe(content.y);
    expect(vb.height).toBe(content.height);
    expect(vb.x + vb.width / 2).toBe(content.x + content.width / 2);
    expect(vb.width).toBeGreaterThanOrEqual(content.width);
  });

  it('zooms past 1:1 for a small diagram, up to the maximum', () => {
    expect(fitView({ x: 0, y: 0, width: 200, height: 150 }, size).scale).toBe(4);
    expect(fitView({ x: 0, y: 0, width: 10, height: 10 }, size).scale).toBe(MAX_SCALE);
  });

  it('goes below the minimum zoom when the diagram needs it', () => {
    expect(fitView({ x: 0, y: 0, width: 16000, height: 100 }, size).scale).toBe(0.05);
  });
});

describe('panBy', () => {
  it('moves the diagram with the pointer', () => {
    const view: View = { x: 0, y: 0, scale: 2 };
    const p = { x: 50, y: 50 };
    const under = screenToDiagram(view, p);
    const after = panBy(view, 30, -10);
    expect(screenToDiagram(after, { x: 80, y: 40 })).toEqual(under);
  });
});

describe('pinchView', () => {
  const start: View = { x: 0, y: 0, scale: 1 };

  it('zooms with the finger spread around the midpoint', () => {
    const after = pinchView(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(after.scale).toBe(2);
    expect(screenToDiagram(after, { x: 150, y: 100 })).toEqual({ x: 150, y: 100 });
  });

  it('pans when both fingers move together', () => {
    const after = pinchView(start, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 130, y: 140 }, { x: 230, y: 140 });
    expect(after.scale).toBe(1);
    expect(screenToDiagram(after, { x: 180, y: 140 })).toEqual({ x: 150, y: 100 });
  });

  it('stops at the zoom limits', () => {
    const after = pinchView(start, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1000, y: 0 });
    expect(after.scale).toBe(MAX_SCALE);
  });
});

describe('resizeView', () => {
  it('keeps the zoom and the diagram point at the center', () => {
    const view: View = { x: 10, y: 10, scale: 2 };
    const after = resizeView(view, size, { width: 400, height: 600 });
    expect(after.scale).toBe(2);
    expect(screenToDiagram(after, { x: 200, y: 300 })).toEqual(screenToDiagram(view, { x: 400, y: 300 }));
  });
});

describe('wheelAction', () => {
  it('pans with a plain wheel, the diagram moving against the scroll', () => {
    expect(wheelAction({ ...wheel, deltaX: 5, deltaY: 30 }, 600)).toEqual({ kind: 'pan', dx: -5, dy: -30 });
  });

  it('turns a vertical wheel sideways with Shift', () => {
    expect(wheelAction({ ...wheel, deltaY: 30, shiftKey: true }, 600)).toEqual({ kind: 'pan', dx: -30, dy: -0 });
  });

  it('converts line and page deltas to pixels', () => {
    expect(wheelAction({ ...wheel, deltaY: 3, deltaMode: 1 }, 600)).toEqual({ kind: 'pan', dx: -0, dy: -48 });
    expect(wheelAction({ ...wheel, deltaY: 1, deltaMode: 2 }, 600)).toEqual({ kind: 'pan', dx: -0, dy: -600 });
  });

  it('zooms with Ctrl (and a trackpad pinch), in on a wheel up, capped per event', () => {
    const pinchIn = wheelAction({ ...wheel, deltaY: -10, ctrlKey: true }, 600);
    expect(pinchIn).toEqual({ kind: 'zoom', factor: 2 ** 0.1 });
    expect(wheelAction({ ...wheel, deltaY: 100, metaKey: true }, 600)).toEqual({ kind: 'zoom', factor: 2 ** -0.5 });
  });

  it('applyWheel zooms around the pointer', () => {
    const view: View = { x: 0, y: 0, scale: 1 };
    const at = { x: 200, y: 100 };
    const after = applyWheel(view, { ...wheel, deltaY: -50, ctrlKey: true }, at, size);
    expect(after.scale).toBeCloseTo(2 ** 0.5, 10);
    expect(screenToDiagram(after, at).x).toBeCloseTo(200, 10);
    expect(screenToDiagram(after, at).y).toBeCloseTo(100, 10);
  });
});

describe('ViewController fit decision', () => {
  const content = { x: 0, y: 0, width: 400, height: 300 };
  const grown = { x: -200, y: 0, width: 1600, height: 300 };

  it('fits on the first update and on a new layout (load, restore, Re-run layout)', () => {
    const c = new ViewController();
    const layoutA = {};
    expect(c.update(layoutA, content, size)).toEqual(viewToViewBox(fitView(content, size), size));
    const layoutB = {};
    expect(c.update(layoutB, grown, size)).toEqual(viewToViewBox(fitView(grown, size), size));
  });

  it('keeps the view after an edit, an undo or an attached .out (same layout), however the content changed', () => {
    const c = new ViewController();
    const layout = {};
    const first = c.update(layout, content, size);
    expect(c.update(layout, grown, size)).toEqual(first);
    expect(c.contentBox).toEqual(grown);
  });

  it('keeps a zoom the user made across redraws', () => {
    const c = new ViewController();
    const layout = {};
    c.update(layout, content, size);
    const zoomed = c.change((v) => zoomAt(v, 2, { x: 0, y: 0 }));
    expect(c.update(layout, content, size)).toEqual(zoomed);
  });

  it('fits once after requestFit (the Fit button), then keeps the view again', () => {
    const c = new ViewController();
    const layout = {};
    c.update(layout, content, size);
    c.change((v) => zoomAt(v, 3, { x: 10, y: 10 }));
    c.requestFit();
    const fitted = c.update(layout, grown, size);
    expect(fitted).toEqual(viewToViewBox(fitView(grown, size), size));
    expect(c.update(layout, content, size)).toEqual(fitted);
  });

  it('keeps the zoom when the canvas is resized, and waits for a size before fitting', () => {
    const c = new ViewController();
    const layout = {};
    expect(c.update(layout, content, { width: 0, height: 0 })).toEqual(content);
    expect(c.change((v) => v)).toBeNull();
    const fitted = c.update(layout, content, size);
    expect(fitted).toEqual(viewToViewBox(fitView(content, size), size));
    const scale = c.current!.scale;
    c.update(layout, content, { width: 400, height: 600 });
    expect(c.current!.scale).toBe(scale);
  });
});
