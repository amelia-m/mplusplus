/**
 * Global controls strip: coefficient mode, display (coefficients, SE, 95%
 * limits, covariance values), decimals and label overlap avoidance, magnitude
 * scaling, significance alpha and p-value source, and a reset of all style
 * overrides. Edits `GlobalStyle` in the store.
 */
import { useStore } from '../state/store.js';
import type { GlobalStyle } from '../render/styles.js';
import { hasConfidenceLimits, type ModelGraph } from '../model/graph.js';
import { parseNumberInput, type NumberSpec } from './numberInput.js';
import { formatNumber, wireLiveSlider } from './liveSlider.js';

export interface GlobalPanelHooks {
  onRedraw(): void;
}

/** Updates one control's displayed value from the current global style. */
type Sync = (g: GlobalStyle) => void;

interface Control {
  el: HTMLElement;
  sync: Sync;
}

/** Keys of `GlobalStyle` whose value type is `V`. */
type KeysOfType<V> = {
  [K in keyof GlobalStyle]: GlobalStyle[K] extends V ? K : never;
}[keyof GlobalStyle];

type Setter = <K extends keyof GlobalStyle>(key: K, v: GlobalStyle[K]) => void;

/**
 * Mounts a global controls strip as a sibling of the toolbar. The controls
 * are built once. The panel subscribes only to `global` and updates the
 * control values in place when it changes (undo, redo, another control), so
 * a control is never replaced while the pointer is on it.
 */
export function mountGlobalPanel(host: HTMLElement, hooks: GlobalPanelHooks): void {
  host.classList.add('global-panel');
  host.innerHTML = '';
  const syncs: Sync[] = [];

  const set: Setter = (key, v) => {
    if (useStore.getState().global[key] === v) return;
    useStore.getState().setGlobal({ [key]: v } as Partial<GlobalStyle>);
    hooks.onRedraw();
  };

  const add = (control: Control): HTMLElement => {
    syncs.push(control.sync);
    return control.el;
  };

  // Confidence limits: grayed out, with a note, while the open file has none.
  const limitsControl = checkboxControl('95% limits', 'showCI', set);
  const limitsBox = limitsControl.el.querySelector('input')!;
  const limitsNote = document.createElement('span');
  limitsNote.className = 'global-note';
  limitsNote.textContent = '(not in this file)';
  limitsControl.el.append(limitsNote);
  const syncLimitsAvailable = (graph: ModelGraph | null): void => {
    const available = hasConfidenceLimits(graph);
    limitsBox.disabled = !available;
    // Inline, so no page color token is needed: the browser grays the box.
    limitsControl.el.style.opacity = available ? '' : '0.55';
    limitsNote.hidden = available;
    limitsControl.el.title = available ? '' : NO_LIMITS_NOTE;
  };

  host.append(
    group('Coefficients', [
      add(
        selectControl(
          'Mode',
          'coefMode',
          [
            ['unstd', 'Unstandardized'],
            ['stdyx', 'STDYX'],
          ],
          set,
        ),
      ),
      add(checkboxControl('Show', 'showCoefficients', set)),
      add(checkboxControl('SE', 'showSE', set)),
      add(limitsControl),
      add(checkboxControl('Covariances', 'showCovarianceLabels', set)),
      add(numberControl('Decimals', 'decimals', { min: 0, max: 6, integer: true }, 1, set)),
      add(checkboxControl('Avoid label overlaps', 'avoidLabelOverlaps', set)),
    ]),
    group('Magnitude', [
      add(checkboxControl('Scale by |coef|', 'magnitudeScaling', set)),
      add(sliderControl('Scale', 'magnitudeScale', { min: 0, max: 10 }, 0.1, set)),
      add(sliderControl('Base width', 'baseEdgeWidth', { min: 0.5, max: 6 }, 0.1, set)),
      add(colorControl('Negative', 'negativeColor', set)),
    ]),
    group('Significance', [
      add(
        selectControl(
          'Alpha',
          'alpha',
          [
            [0.05, 'α = 0.05'],
            [0.01, 'α = 0.01'],
          ],
          set,
        ),
      ),
      add(
        selectControl(
          'p source',
          'pSource',
          [
            ['auto', 'Auto'],
            ['tstat', 't-stat only'],
            ['pvalue', '.out p-value only'],
          ],
          set,
        ),
      ),
    ]),
    group('Reset', [
      button('Reset styles', () => {
        useStore.getState().resetStyles();
        hooks.onRedraw();
      }),
    ]),
  );

  const syncAll = (g: GlobalStyle): void => {
    for (const s of syncs) s(g);
  };
  useStore.subscribe((s, prev) => {
    if (s.global !== prev.global) syncAll(s.global);
    if (s.graph !== prev.graph) syncLimitsAvailable(s.graph);
  });
  syncAll(useStore.getState().global);
  syncLimitsAvailable(useStore.getState().graph);
}

/** Shown on the limits option while the open file has no confidence limits. */
export const NO_LIMITS_NOTE = 'This file has no confidence limits: run the model with OUTPUT: CINTERVAL.';

// ----------------- DOM helpers -----------------

function group(title: string, children: HTMLElement[]): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'global-group';
  const lbl = document.createElement('span');
  lbl.className = 'global-group-label';
  lbl.textContent = title;
  wrap.append(lbl, ...children);
  return wrap;
}

/** A `<label>` holding the caption text; the caller appends the control. */
function labeled(label: string, cls = 'global-control'): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.className = cls;
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(text);
  return wrap;
}

function checkboxControl(label: string, key: KeysOfType<boolean>, set: Setter): Control {
  const wrap = document.createElement('label');
  wrap.className = 'global-control';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => set(key, cb.checked));
  const text = document.createElement('span');
  text.textContent = label;
  wrap.append(cb, text);
  return {
    el: wrap,
    sync: (g) => {
      cb.checked = g[key];
    },
  };
}

function selectControl<K extends 'coefMode' | 'alpha' | 'pSource'>(
  label: string,
  key: K,
  options: [GlobalStyle[K], string][],
  set: Setter,
): Control {
  const wrap = labeled(label);
  const sel = document.createElement('select');
  for (const [val, lab] of options) {
    const opt = document.createElement('option');
    opt.value = String(val);
    opt.textContent = lab;
    sel.append(opt);
  }
  sel.addEventListener('change', () => {
    const match = options.find((o) => String(o[0]) === sel.value);
    if (match) set(key, match[0]);
  });
  wrap.append(sel);
  return {
    el: wrap,
    sync: (g) => {
      sel.value = String(g[key]);
    },
  };
}

function numberControl(
  label: string,
  key: KeysOfType<number>,
  spec: NumberSpec,
  step: number,
  set: Setter,
): Control {
  const wrap = labeled(label);
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.min = String(spec.min);
  inp.max = String(spec.max);
  inp.step = String(step);
  inp.addEventListener('change', () => {
    const v = parseNumberInput(inp.value, spec);
    // Show the value that is actually stored: the clamped value, or the
    // unchanged one when the input was empty or invalid.
    inp.value = formatNumber(v ?? useStore.getState().global[key]);
    if (v !== null) set(key, v);
  });
  wrap.append(inp);
  return {
    el: wrap,
    sync: (g) => {
      inp.value = formatNumber(g[key]);
    },
  };
}

function sliderControl(
  label: string,
  key: KeysOfType<number>,
  spec: NumberSpec,
  step: number,
  set: Setter,
): Control {
  const wrap = labeled(label, 'global-control slider');
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(spec.min);
  slider.max = String(spec.max);
  slider.step = String(step);
  const readout = document.createElement('span');
  readout.className = 'slider-readout';
  wireLiveSlider(slider, spec, (v) => {
    readout.textContent = formatNumber(v);
    set(key, v);
  });
  wrap.append(slider, readout);
  return {
    el: wrap,
    sync: (g) => {
      slider.value = String(g[key]);
      readout.textContent = formatNumber(g[key]);
    },
  };
}

function colorControl(label: string, key: 'negativeColor' | 'nsColor', set: Setter): Control {
  const wrap = labeled(label);
  const inp = document.createElement('input');
  inp.type = 'color';
  inp.addEventListener('change', () => set(key, inp.value));
  wrap.append(inp);
  return {
    el: wrap,
    sync: (g) => {
      inp.value = g[key];
    },
  };
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}
