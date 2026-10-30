import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HISTORY_LIMIT, historyEqual, historySlice, useStore, type NodePosition } from './store.js';
import { beginGesture, endActiveGesture, endGesture, isGestureActive, onGestureEnd } from './gesture.js';
import { redoHistory, undoHistory } from './history.js';
import { alignSelected } from '../render/align.js';

// Same cast shape the app uses: zundo attaches `temporal` as a sibling store.
const temporal = (useStore as unknown as {
  temporal: {
    getState(): {
      pastStates: unknown[];
      futureStates: unknown[];
      isTracking: boolean;
      undo(): void;
      clear(): void;
    };
  };
}).temporal;

const past = (): number => temporal.getState().pastStates.length;
const pos = (x: number, y = 0): NodePosition => ({ x, y, width: 120, height: 56 });

beforeEach(() => {
  // A test that failed mid-gesture must not leak into the next one.
  endActiveGesture();
  useStore.setState({ positions: { a: pos(10) }, selection: new Set(), edgeSelection: new Set() });
  temporal.getState().clear();
});

describe('undo gestures (Y1)', () => {
  it('records one entry for a whole gesture and one undo restores the pre-gesture state', () => {
    const before = past();
    const g = beginGesture();
    useStore.getState().setNodePosition('a', pos(20));
    useStore.getState().setNodePosition('a', pos(30));
    useStore.getState().setNodePosition('a', pos(40));
    endGesture(g);
    expect(past()).toBe(before + 1);
    expect(useStore.getState().positions.a.x).toBe(40);

    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(10);
  });

  it('adds no entry for a gesture with no change', () => {
    const before = past();
    const g = beginGesture();
    endGesture(g);
    expect(past()).toBe(before);
  });

  it('ignores a non-history change before the first real change in a gesture', () => {
    const before = past();
    const g = beginGesture();
    useStore.getState().setSelection(['a']);
    useStore.getState().setNodePosition('a', pos(20));
    useStore.getState().setNodePosition('a', pos(30));
    endGesture(g);
    expect(past()).toBe(before + 1);
    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(10);
  });

  it('resumes tracking after a gesture so the next change is its own entry', () => {
    const g = beginGesture();
    useStore.getState().setNodePosition('a', pos(20));
    endGesture(g);
    expect(temporal.getState().isTracking).toBe(true);
    const before = past();
    useStore.getState().setNodePosition('a', pos(50));
    expect(past()).toBe(before + 1);
  });

  it('a foreign or stale token does not end another owner gesture (F4)', () => {
    const stale = beginGesture();
    endGesture(stale);
    const before = past();
    const a = beginGesture();
    const b = beginGesture(); // a second would-be owner gets no token
    expect(b).toBeNull();
    useStore.getState().setNodePosition('a', pos(20));
    endGesture(b);
    expect(isGestureActive()).toBe(true);
    endGesture(stale);
    expect(isGestureActive()).toBe(true);
    useStore.getState().setNodePosition('a', pos(30));
    expect(past()).toBe(before);
    endGesture(a);
    expect(isGestureActive()).toBe(false);
    expect(past()).toBe(before + 1);
    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(10);
  });

  it('endActiveGesture ends whatever gesture is active (load-time cleanup)', () => {
    const before = past();
    const a = beginGesture();
    useStore.getState().setNodePosition('a', pos(20));
    endActiveGesture();
    expect(isGestureActive()).toBe(false);
    expect(past()).toBe(before + 1);
    endGesture(a); // the owner's later end is now a no-op
    expect(past()).toBe(before + 1);
    endActiveGesture(); // and so is a second cleanup
    expect(past()).toBe(before + 1);
  });

  it('notifies gesture-end listeners once per gesture, and supports unsubscribe', () => {
    let calls = 0;
    const ended: unknown[] = [];
    const off = onGestureEnd((t) => {
      calls++;
      ended.push(t);
    });
    const g = beginGesture();
    endGesture(g);
    endGesture(g);
    expect(calls).toBe(1);
    expect(ended).toEqual([g]);
    off();
    endGesture(beginGesture());
    expect(calls).toBe(1);
  });

  it('a throwing gesture-end listener does not stop later listeners (it stranded the slider token)', () => {
    const seen: string[] = [];
    const offA = onGestureEnd(() => {
      seen.push('a');
      throw new Error('listener boom');
    });
    const offB = onGestureEnd(() => seen.push('b'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Reported, not thrown: a throw aborted callers' cleanup (a drag left
      // dead after re-press, a file load stopped before temporal.clear()).
      expect(() => endGesture(beginGesture())).not.toThrow();
      expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'listener boom' }));
      expect(seen).toEqual(['a', 'b']);
      expect(isGestureActive()).toBe(false);
      expect(temporal.getState().isTracking).toBe(true);
    } finally {
      errorSpy.mockRestore();
      offA();
      offB();
    }
  });

  it('ends the gesture when work inside it throws (try/finally contract)', () => {
    expect(() => {
      const g = beginGesture();
      try {
        useStore.getState().setNodePosition('a', pos(20));
        throw new Error('boom');
      } finally {
        endGesture(g);
      }
    }).toThrow('boom');
    expect(isGestureActive()).toBe(false);
    expect(temporal.getState().isTracking).toBe(true);
  });
});

describe('undo / redo helpers (F7)', () => {
  it('do nothing while a gesture is active, and act once it ends', () => {
    useStore.getState().setNodePosition('a', pos(20));
    const g = beginGesture();
    useStore.getState().setNodePosition('a', pos(30));
    expect(undoHistory()).toBe(false);
    expect(redoHistory()).toBe(false);
    expect(useStore.getState().positions.a.x).toBe(30);
    expect(isGestureActive()).toBe(true);
    endGesture(g);

    expect(undoHistory()).toBe(true);
    expect(useStore.getState().positions.a.x).toBe(20);
    expect(redoHistory()).toBe(true);
    expect(useStore.getState().positions.a.x).toBe(30);
  });
});

describe('history equality (Y2)', () => {
  it('selection changes add no undo entry', () => {
    const before = past();
    useStore.getState().setSelection(['a']);
    useStore.getState().addToSelection('b');
    useStore.getState().clearAllSelection();
    useStore.getState().setEdgeSelection(['e1']);
    expect(past()).toBe(before);
  });
});

describe('gesture history robustness (R1)', () => {
  it('keeps history at the limit and one undo still restores the pre-gesture state', () => {
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) {
      useStore.getState().setNodePosition('a', pos(1000 + i));
    }
    expect(past()).toBe(HISTORY_LIMIT);
    const preGesture = useStore.getState().positions.a.x;

    const g = beginGesture();
    useStore.getState().setNodePosition('a', pos(1));
    useStore.getState().setNodePosition('a', pos(2));
    endGesture(g);
    expect(past()).toBe(HISTORY_LIMIT);

    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(preGesture);
  });

  it('restores the full pre-gesture state when a store listener writes history inside the first change', () => {
    // A listener that derives one history field from another. Its nested
    // write happens inside the first gesture change, so the pre-gesture
    // state must not depend on the order zundo records entries in.
    const off = useStore.subscribe((s, prev) => {
      if (s.positions !== prev.positions && s.global.decimals !== 7) {
        useStore.getState().setGlobal({ decimals: 7 });
      }
    });
    const decimalsBefore = useStore.getState().global.decimals;
    try {
      const g = beginGesture();
      useStore.getState().setNodePosition('a', pos(20));
      useStore.getState().setNodePosition('a', pos(30));
      endGesture(g);
    } finally {
      off();
    }
    expect(decimalsBefore).not.toBe(7);
    temporal.getState().undo();
    expect(useStore.getState().positions.a.x).toBe(10);
    expect(useStore.getState().global.decimals).toBe(decimalsBefore);
  });

  it('clears redo history when a gesture records an entry', () => {
    useStore.getState().setNodePosition('a', pos(20));
    temporal.getState().undo();
    expect(temporal.getState().futureStates.length).toBe(1);
    const g = beginGesture();
    useStore.getState().setNodePosition('a', pos(30));
    endGesture(g);
    expect(temporal.getState().futureStates.length).toBe(0);
  });

  it('shares one history slice and equality with the temporal options', () => {
    const s = useStore.getState();
    const slice = historySlice(s);
    expect(Object.keys(slice).sort()).toEqual(['edgeStyles', 'global', 'nodeStyles', 'pValues', 'positions']);
    expect(historyEqual(slice, historySlice(s))).toBe(true);
    s.setNodePosition('a', pos(77));
    expect(historyEqual(slice, historySlice(useStore.getState()))).toBe(false);
  });
});

describe('no-op writes add no undo entry (Q3)', () => {
  it('setGlobal with the current value adds 0 entries and keeps the same object', () => {
    const before = past();
    const g = useStore.getState().global;
    useStore.getState().setGlobal({ decimals: g.decimals });
    useStore.getState().setGlobal({});
    expect(past()).toBe(before);
    expect(useStore.getState().global).toBe(g);
  });

  it('setNodePositions({}) and a same-value position add 0 entries', () => {
    const before = past();
    const p = useStore.getState().positions;
    useStore.getState().setNodePositions({});
    useStore.getState().setNodePositions({ a: pos(10) });
    useStore.getState().setNodePosition('a', pos(10));
    expect(past()).toBe(before);
    expect(useStore.getState().positions).toBe(p);
  });

  it('a gesture that returns to its start adds 0 entries', () => {
    const before = past();
    const g = beginGesture();
    useStore.getState().setNodePositions({ a: pos(20) });
    useStore.getState().setNodePositions({ a: pos(10) });
    endGesture(g);
    expect(past()).toBe(before);
  });

  it('a second identical align adds 0 entries', () => {
    useStore.setState({ positions: { a: pos(10, 0), b: pos(30, 50) }, selection: new Set(['a', 'b']) });
    temporal.getState().clear();
    alignSelected('left');
    expect(past()).toBe(1);
    alignSelected('left');
    expect(past()).toBe(1);
  });

  it('Reset with no overrides adds 0 entries', () => {
    useStore.setState({ edgeStyles: {}, nodeStyles: {} });
    temporal.getState().clear();
    useStore.getState().resetStyles();
    expect(past()).toBe(0);
  });

  it('a same-value style commit (for example a clamped inspector value) adds 0 entries', () => {
    useStore.getState().setNodeStyles(['a'], { strokeWidth: 10 });
    useStore.getState().setEdgeStyles(['e1'], { strokeWidth: 10 });
    const before = past();
    useStore.getState().setNodeStyles(['a'], { strokeWidth: 10 });
    useStore.getState().setNodeStyle('a', { strokeWidth: 10 });
    useStore.getState().setEdgeStyles(['e1'], { strokeWidth: 10 });
    useStore.getState().setEdgeStyle('e1', { strokeWidth: 10 });
    useStore.getState().setNodeStyles([], { strokeWidth: 4 });
    expect(past()).toBe(before);
  });

  it('setPValues with the same entries adds 0 entries', () => {
    useStore.getState().setPValues({ e1: { unstd: 0.01, stdyx: 0.02 } });
    const before = past();
    useStore.getState().setPValues({ e1: { unstd: 0.01, stdyx: 0.02 } });
    useStore.getState().setPValues({});
    expect(past()).toBe(before);
  });

  it('survival: a real change through each action still adds exactly 1 entry', () => {
    const steps: Array<() => void> = [
      () => useStore.getState().setGlobal({ decimals: useStore.getState().global.decimals + 1 }),
      () => useStore.getState().setNodePositions({ a: pos(11) }),
      () => useStore.getState().setNodeStyles(['a'], { fill: '#123456' }),
      () => useStore.getState().setNodeStyle('a', { fill: '#fff' }),
      () => useStore.getState().setEdgeStyles(['e1'], { stroke: '#654321' }),
      () => useStore.getState().resetStyles(),
      () => useStore.getState().setPValues({ e2: { unstd: 0.5, stdyx: null } }),
    ];
    for (const step of steps) {
      const before = past();
      step();
      expect(past()).toBe(before + 1);
    }
    const before = past();
    const g = beginGesture();
    useStore.getState().setNodePositions({ a: pos(40) });
    useStore.getState().setNodePositions({ a: pos(41) });
    endGesture(g);
    expect(past()).toBe(before + 1);
  });
});

describe('empty style overrides are never stored (F2.7)', () => {
  beforeEach(() => {
    useStore.setState({ nodeStyles: {}, edgeStyles: {} });
    temporal.getState().clear();
  });

  it('clearing the last field of an override deletes its record (it stored {})', () => {
    useStore.getState().setNodeStyles(['a'], { fill: '#111111' });
    useStore.getState().setEdgeStyles(['e1'], { stroke: '#222222' });
    const before = past();
    useStore.getState().setNodeStyles(['a'], { fill: undefined });
    expect(past()).toBe(before + 1);
    useStore.getState().setEdgeStyles(['e1'], { stroke: undefined });
    expect(useStore.getState().nodeStyles).toEqual({});
    expect('a' in useStore.getState().nodeStyles).toBe(false);
    expect('e1' in useStore.getState().edgeStyles).toBe(false);
    expect(past()).toBe(before + 2);
  });

  it('does not store undefined fields (they overwrote the base style when merged)', () => {
    useStore.getState().setNodeStyles(['a'], { fill: '#111111', stroke: undefined });
    expect(Object.keys(useStore.getState().nodeStyles.a)).toEqual(['fill']);
  });

  it('a patch of only undefined fields on an object with no override stores nothing and adds 0 entries', () => {
    const cur = useStore.getState().nodeStyles;
    useStore.getState().setNodeStyles(['a', 'b'], { fill: undefined });
    useStore.getState().setEdgeStyles(['e1'], { stroke: undefined });
    expect(useStore.getState().nodeStyles).toBe(cur);
    expect(useStore.getState().edgeStyles).toEqual({});
    expect(past()).toBe(0);
  });

  it('keeps an override whose value equals the default, since it pins the value', () => {
    useStore.getState().setNodeStyles(['a'], { shape: null });
    expect(useStore.getState().nodeStyles).toEqual({ a: { shape: null } });
  });
});
