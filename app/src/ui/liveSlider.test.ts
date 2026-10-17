/**
 * `wireLiveSlider` in Vitest's node environment: the slider and the window
 * are minimal event-target fakes, which is all the wiring touches. The
 * fakes record which listeners are attached, so the tests can check that a
 * scrub leaves none behind on the window.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { wireLiveSlider } from './liveSlider.js';
import { useStore } from '../state/store.js';
import { beginGesture, endActiveGesture, endGesture, isGestureActive } from '../state/gesture.js';

const temporal = (useStore as unknown as {
  temporal: { getState(): { pastStates: unknown[]; undo(): void; clear(): void } };
}).temporal;
const past = (): number => temporal.getState().pastStates.length;

/**
 * A minimal event target that calls listeners synchronously, so an error
 * thrown by a listener reaches the test (Node's `EventTarget` reports it
 * asynchronously instead), and that tracks attached listeners by type.
 */
class SyncTarget {
  readonly attached = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void): void {
    const set = this.attached.get(type) ?? new Set();
    set.add(fn);
    this.attached.set(type, set);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.attached.get(type)?.delete(fn);
  }
  fire(type: string): void {
    for (const fn of [...(this.attached.get(type) ?? [])]) fn();
  }
  count(...types: string[]): number {
    return types.reduce((n, t) => n + (this.attached.get(t)?.size ?? 0), 0);
  }
}

class FakeSlider extends SyncTarget {
  value = '0';
  /** Simulate the user moving the thumb to `v`. */
  scrub(v: number): void {
    this.value = String(v);
    this.fire('input');
  }
}

const win = new SyncTarget();
const WINDOW_TYPES = ['pointerup', 'pointercancel', 'blur'];

beforeAll(() => {
  (globalThis as { window?: unknown }).window = win;
});

let slider: FakeSlider;
let applied: number[];

beforeEach(() => {
  endActiveGesture();
  useStore.setState({ global: { ...useStore.getState().global, magnitudeScale: 3 } });
  temporal.getState().clear();
  slider = new FakeSlider();
  applied = [];
  wireLiveSlider(slider as unknown as HTMLInputElement, { min: 0, max: 10 }, (v) => {
    applied.push(v);
    useStore.getState().setGlobal({ magnitudeScale: v });
  });
});

afterEach(() => {
  endActiveGesture();
});

const scale = (): number => useStore.getState().global.magnitudeScale;

describe('wireLiveSlider (Q10)', () => {
  it('begins a gesture on the first input and applies every value', () => {
    expect(isGestureActive()).toBe(false);
    slider.scrub(4);
    expect(isGestureActive()).toBe(true);
    slider.scrub(5);
    slider.scrub(6);
    expect(applied).toEqual([4, 5, 6]);
    expect(scale()).toBe(6);
    expect(win.count(...WINDOW_TYPES)).toBe(3);
  });

  for (const [what, end] of [
    ['slider change', () => slider.fire('change')],
    ['slider blur', () => slider.fire('blur')],
    ['window pointerup', () => win.fire('pointerup')],
    ['window pointercancel', () => win.fire('pointercancel')],
    ['window blur', () => win.fire('blur')],
  ] as const) {
    it(`ends on ${what}: one undo entry, window listeners removed, one undo restores`, () => {
      slider.scrub(4);
      slider.scrub(7);
      end();
      expect(isGestureActive()).toBe(false);
      expect(past()).toBe(1);
      expect(win.count(...WINDOW_TYPES)).toBe(0);
      temporal.getState().undo();
      expect(scale()).toBe(3);
    });
  }

  it('records one undo entry per scrub, and change after pointerup applies nothing', () => {
    slider.scrub(4);
    slider.scrub(5);
    win.fire('pointerup');
    slider.fire('change'); // browsers fire change after the release
    expect(past()).toBe(1);
    expect(applied).toEqual([4, 5]);

    slider.scrub(8);
    slider.fire('change');
    expect(past()).toBe(2);
    expect(win.count(...WINDOW_TYPES)).toBe(0);
  });

  it('ignores an input that does not parse, without starting a gesture', () => {
    slider.value = '';
    slider.fire('input');
    expect(isGestureActive()).toBe(false);
    expect(applied).toEqual([]);
  });

  it('null token: inside another gesture it applies there, hooks nothing and ends nothing', () => {
    const other = beginGesture();
    expect(other).not.toBeNull();
    slider.scrub(4);
    slider.scrub(6);
    expect(applied).toEqual([4, 6]);
    expect(win.count(...WINDOW_TYPES)).toBe(0);
    slider.fire('change');
    win.fire('pointerup');
    expect(isGestureActive()).toBe(true);
    endGesture(other);
    expect(past()).toBe(1);
  });

  it('ends its gesture when apply throws', () => {
    const throwing = new FakeSlider();
    wireLiveSlider(throwing as unknown as HTMLInputElement, { min: 0, max: 10 }, () => {
      throw new Error('boom');
    });
    expect(() => throwing.scrub(2)).toThrow('boom');
    expect(isGestureActive()).toBe(false);
    expect(win.count(...WINDOW_TYPES)).toBe(0);
  });

  it('drops its window listeners when load-time cleanup ends the gesture', () => {
    slider.scrub(4);
    endActiveGesture();
    expect(win.count(...WINDOW_TYPES)).toBe(0);
    slider.scrub(5); // a later scrub starts a fresh gesture
    expect(isGestureActive()).toBe(true);
  });
});
