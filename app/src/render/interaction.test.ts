import { describe, expect, it } from 'vitest';
import {
  dragShouldMove,
  dragStartAction,
  exceedsClickThreshold,
  groupDragPositions,
  nodePointerSelection,
} from './interaction.js';

describe('groupDragPositions (Y3)', () => {
  const start = new Map([
    ['a', { x: 100, y: 200, width: 120, height: 56 }],
    ['b', { x: 400, y: 50, width: 120, height: 56 }],
  ]);
  // Grabbed node `a` 30 px right of and 20 px below its top-left corner.
  const pointerStart = { x: 130, y: 220 };

  for (const d of [0, 1, 50]) {
    it(`keeps the grab offset after a ${d} px move`, () => {
      const pointer = { x: pointerStart.x + d, y: pointerStart.y - d };
      const out = groupDragPositions(start, pointerStart, pointer);
      expect(pointer.x - out.a.x).toBe(30);
      expect(pointer.y - out.a.y).toBe(20);
    });
  }

  it('moves every node in the group by the same delta and keeps sizes', () => {
    const out = groupDragPositions(start, pointerStart, { x: 140, y: 205 });
    expect(out.a).toEqual({ x: 110, y: 185, width: 120, height: 56 });
    expect(out.b).toEqual({ x: 410, y: 35, width: 120, height: 56 });
  });
});

describe('exceedsClickThreshold', () => {
  it('counts movement under the threshold as a click', () => {
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 2, y: 2 })).toBe(false);
    expect(exceedsClickThreshold({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(true);
  });
});

describe('nodePointerSelection (Y4)', () => {
  const sel = (...ids: string[]) => new Set(ids);
  const ids = (r: ReturnType<typeof nodePointerSelection>) =>
    r === null ? null : { nodes: [...r.nodes].sort(), clearEdges: r.clearEdges };

  describe('press', () => {
    it('on a selected node keeps the whole selection', () => {
      expect(nodePointerSelection(sel('a', 'b'), 'a', false, 'press', false)).toBeNull();
    });
    it('with Shift on a selected node keeps the whole selection', () => {
      expect(nodePointerSelection(sel('a', 'b'), 'a', true, 'press', false)).toBeNull();
    });
    it('on an unselected node selects only it and clears edges', () => {
      expect(ids(nodePointerSelection(sel('a', 'b'), 'c', false, 'press', false))).toEqual({
        nodes: ['c'],
        clearEdges: true,
      });
    });
    it('with Shift on an unselected node adds it', () => {
      expect(ids(nodePointerSelection(sel('a'), 'c', true, 'press', false))).toEqual({
        nodes: ['a', 'c'],
        clearEdges: false,
      });
    });
  });

  describe('release (selection is the one at press time)', () => {
    it('plain click on a selected node collapses the selection to it', () => {
      expect(ids(nodePointerSelection(sel('a', 'b'), 'a', false, 'release', false))).toEqual({
        nodes: ['a'],
        clearEdges: true,
      });
    });
    it('Shift-click on a selected node toggles it out', () => {
      expect(ids(nodePointerSelection(sel('a', 'b'), 'a', true, 'release', false))).toEqual({
        nodes: ['b'],
        clearEdges: false,
      });
    });
    it('after a drag of a selected node leaves the group selected', () => {
      expect(nodePointerSelection(sel('a', 'b'), 'a', false, 'release', true)).toBeNull();
      expect(nodePointerSelection(sel('a', 'b'), 'a', true, 'release', true)).toBeNull();
    });
    it('on a node that was unselected at press changes nothing more', () => {
      expect(nodePointerSelection(sel('a'), 'c', false, 'release', false)).toBeNull();
      expect(nodePointerSelection(sel('a'), 'c', true, 'release', false)).toBeNull();
      expect(nodePointerSelection(sel('a'), 'c', true, 'release', true)).toBeNull();
    });
  });

  it('does not mutate the input selection', () => {
    const s = sel('a', 'b');
    nodePointerSelection(s, 'a', true, 'release', false);
    nodePointerSelection(s, 'c', true, 'press', false);
    expect([...s].sort()).toEqual(['a', 'b']);
  });
});

describe('dragShouldMove (R2)', () => {
  const press = { x: 100, y: 100 };
  it('does not move while the pointer stays under the click threshold', () => {
    expect(dragShouldMove(press, { x: 100, y: 100 }, false)).toBe(false);
    expect(dragShouldMove(press, { x: 102, y: 101 }, false)).toBe(false);
  });
  it('starts moving once the pointer crosses the threshold', () => {
    expect(dragShouldMove(press, { x: 103, y: 100 }, false)).toBe(true);
    expect(dragShouldMove(press, { x: 98, y: 96 }, false)).toBe(true);
  });
  it('keeps moving after it has started, even back inside the threshold', () => {
    expect(dragShouldMove(press, { x: 101, y: 100 }, true)).toBe(true);
    expect(dragShouldMove(press, press, true)).toBe(true);
  });
});

describe('dragStartAction (R3, R4)', () => {
  it('begins a session when none is active', () => {
    expect(dragStartAction(null, 'mouse')).toBe('begin');
  });
  it('replaces a stale session for the same pointer (its end was missed)', () => {
    expect(dragStartAction('mouse', 'mouse')).toBe('replace');
    expect(dragStartAction(4, 4)).toBe('replace');
  });
  it('ignores a second pointer while a session is active (multi-touch)', () => {
    expect(dragStartAction(4, 5)).toBe('ignore');
    expect(dragStartAction(4, 'mouse')).toBe('ignore');
    expect(dragStartAction('mouse', 0)).toBe('ignore');
  });
});
