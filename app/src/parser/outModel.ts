/**
 * Read a model from an Mplus `.out` alone, with no `.dgm`, as a `DgmFile`
 * that `buildGraph` takes like any other (the adapter Amelia chose,
 * 2026-11-04). Scope: single-group models with continuous outcomes, as ML
 * or MLR give them (Amelia, 2026-11-03); anything else is refused with a
 * reason (`unsupportedOutReason`), and later work extends the coverage.
 *
 * Where each part comes from:
 * - the input echo (`INPUT INSTRUCTIONS`) goes through `parseInputBlock`, the
 *   same reader `parseDgm` uses, so labels, pins and list ranges match;
 * - `SUMMARY OF ANALYSIS` lists the observed and latent variables, which give
 *   `header.allVariables` (dependent observed, latents, independent observed,
 *   the order Mplus writes in a `.dgm`);
 * - `MODEL RESULTS` and STDYX rows (`parseOut`) become estimate rows: code 1
 *   for BY and ON, 2 for WITH, 4 for residual variances and 5 for variances,
 *   plus 10 for STDYX; syntax labels become label rows 91, 92, 94 and 95.
 *
 * `header.levels` is null, so the `sem` layout computes the columns itself
 * (`layout/semColumns.ts`). A `.out` does not print the `999.000` covariance
 * rows a `.dgm` has for exogenous pairs, so those curves are missing; their
 * rule is a separate contract (Amelia, 2026-11-04).
 */
import { parseInputBlock, type DgmFile, type EstimateRow, type ModelStmt, type ParsedInput } from './dgm.js';
import { parseOut, type OutRow } from './out.js';

/** Why a `.out` cannot be opened on its own. */
export type OutRefusal =
  | 'montecarlo'
  | 'groups'
  | 'classes'
  | 'levels'
  | 'bayes'
  | 'categorical'
  | 'abnormal'
  | 'no-results';

const SO_FAR = 'only single-group models with continuous outcomes open on their own so far';

/** The message shown for each refusal. */
export const OUT_REFUSAL_MESSAGES: Record<OutRefusal, string> = {
  montecarlo: `This .out is a Monte Carlo run; ${SO_FAR}.`,
  groups: 'This .out is a multiple-group analysis; only single-group models open on their own so far.',
  classes: `This .out has latent classes (a mixture model); ${SO_FAR}.`,
  levels: `This .out is a multilevel analysis; ${SO_FAR}.`,
  bayes: `This .out is a Bayesian analysis; ${SO_FAR}.`,
  categorical:
    'This .out has outcomes that are not continuous (categorical, count or censored); only models with continuous outcomes open on their own so far.',
  abnormal: 'Mplus did not finish estimating this model normally, so this .out has no results to draw.',
  'no-results': 'This .out has no MODEL RESULTS section to draw a diagram from.',
};

/**
 * Checks in order, each a line Mplus prints (seen in Mplus 8.11 output: the
 * synthetic fixtures and the local User's Guide outputs, 2026-11-04). The
 * first that matches decides.
 */
const REFUSAL_CHECKS: { reason: OutRefusal; test: (text: string) => boolean }[] = [
  { reason: 'montecarlo', test: (t) => /^\s*Number of replications\b/im.test(t) },
  {
    reason: 'groups',
    test: (t) => {
      const m = /^\s*Number of groups\s+(\d+)\s*$/im.exec(t);
      return m !== null && Number(m[1]) > 1;
    },
  },
  {
    reason: 'classes',
    test: (t) => /^\s*Categorical latent variables\s*$/im.test(t) || /^\s*Latent Class\b/m.test(t),
  },
  { reason: 'levels', test: (t) => /^\s*(?:Within|Between) Level\s*$/m.test(t) },
  {
    reason: 'bayes',
    test: (t) => /^\s*Estimator\s+BAYES\s*$/im.test(t) || /^\s*Posterior\s+One-Tailed\b/m.test(t),
  },
  {
    reason: 'categorical',
    test: (t) =>
      /^\s*Thresholds\s*$/m.test(t) ||
      /^\s*(?:Binary and ordered categorical|Unordered categorical|Count|Censored)\b/m.test(t),
  },
  { reason: 'abnormal', test: (t) => !/THE MODEL ESTIMATION TERMINATED NORMALLY/.test(t) },
  { reason: 'no-results', test: (t) => !/^\s*MODEL RESULTS\s*$/m.test(t) },
];

/** Why `text` cannot be opened on its own, or null when it can. */
export function unsupportedOutReason(text: string): OutRefusal | null {
  return REFUSAL_CHECKS.find((c) => c.test(text))?.reason ?? null;
}

/** A `.out` read as a model, or why it was refused. */
export type OutModel =
  | {
      ok: true;
      dgm: DgmFile;
      /** False when the `.out` has no input echo (`NOECHO`): labels and pins are then unknown. */
      echo: boolean;
    }
  | { ok: false; reason: OutRefusal; message: string };

/** Read `text`, an Mplus `.out`, as a model, or say why it cannot be. Never throws. */
export function readOutModel(text: string): OutModel {
  const normalized = text.replace(/\r\n?/g, '\n');
  const reason = unsupportedOutReason(normalized);
  if (reason) return { ok: false, reason, message: OUT_REFUSAL_MESSAGES[reason] };

  const lines = normalized.split('\n');
  const echo = inputEcho(lines);
  const results = parseOut(normalized);
  const summary = summaryLists(lines);
  const input: ParsedInput = echo
    ? parseInputBlock(echo)
    : {
        variables: [...summary.dependent, ...summary.independent],
        useVar: [...summary.dependent, ...summary.independent],
        weights: [],
        modelStatements: statementsFromResults(results.unstd),
      };

  const latentSet = new Set(summary.latents);
  const allVariables = summary.found
    ? [...summary.dependent, ...summary.latents, ...summary.independent]
    : namesInRows(results.unstd);
  // Like a `.dgm`'s header: one grouping per latent with observed
  // indicators, listing only those (a second-order factor has none).
  const groupings = summary.latents.flatMap((latent) => {
    const observed = results.unstd
      .filter((r) => r.block === 'BY' && r.from === latent && r.to !== null && !latentSet.has(r.to))
      .map((r) => r.to as string);
    return observed.length > 0 ? [{ latent, observed: uniq(observed) }] : [];
  });

  const estimates = [
    ...estimateRows(results.unstd, 0),
    ...labelRows(input.modelStatements, new Set(summary.dependent), latentSet),
    ...estimateRows(results.stdyx, 10),
  ];

  const dgm: DgmFile = {
    inputBlock: echo ? `${echo}INPUT_END\n` : '',
    ...input,
    header: { allVariables, groupings, levels: null },
    estimates,
    latents: groupings.map((g) => g.latent),
    observed: uniq(groupings.flatMap((g) => g.observed)),
    origin: 'out',
  };
  return { ok: true, dgm, echo: echo !== null };
}

/** `readOutModel` for callers that want a `DgmFile` or an error (restoring a saved session). */
export function outToDgm(text: string): DgmFile {
  const model = readOutModel(text);
  if (!model.ok) throw new Error(model.message);
  return model.dgm;
}

/**
 * The input echo: the lines after `INPUT INSTRUCTIONS` up to the line that
 * ends it (`INPUT READING TERMINATED ...`, or a `*** WARNING` or `*** ERROR`
 * about the input). Null when the `.out` has none (`NOECHO`).
 */
function inputEcho(lines: string[]): string | null {
  const start = lines.findIndex((l) => /^\s*INPUT INSTRUCTIONS\s*$/.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*(?:INPUT READING TERMINATED|\*\*\* (?:WARNING|ERROR))/.test(l));
  const body = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  return body.trim() ? `${body}\n` : null;
}

interface SummaryLists {
  /** True when the `.out` has at least one of the lists. */
  found: boolean;
  dependent: string[];
  independent: string[];
  latents: string[];
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_#]*$/;

/**
 * The variable lists of `SUMMARY OF ANALYSIS`, lower-cased:
 *
 *     Observed dependent variables
 *
 *       Continuous
 *        A1          A2 ...
 *
 *     Observed independent variables
 *        Z1
 *
 *     Continuous latent variables
 *        FA          FB ...
 */
function summaryLists(lines: string[]): SummaryLists {
  const list = (header: RegExp): string[] | null => {
    const at = lines.findIndex((l) => header.test(l));
    if (at < 0) return null;
    let i = at + 1;
    while (i < lines.length && !lines[i].trim()) i++;
    if (/^\s*Continuous\s*$/.test(lines[i] ?? '')) i++;
    const names: string[] = [];
    for (; i < lines.length && lines[i].trim(); i++) {
      const tokens = lines[i].trim().split(/\s+/);
      if (!tokens.every((t) => NAME_RE.test(t))) break;
      names.push(...tokens.map((t) => t.toLowerCase()));
    }
    return names;
  };
  const dependent = list(/^\s*Observed dependent variables\s*$/i);
  const independent = list(/^\s*Observed independent variables\s*$/i);
  const latents = list(/^\s*Continuous latent variables\s*$/i);
  return {
    found: dependent !== null || independent !== null || latents !== null,
    dependent: dependent ?? [],
    independent: independent ?? [],
    latents: latents ?? [],
  };
}

/** Every name in `rows`, in first-seen order: the variable list when the summary is missing. */
function namesInRows(rows: OutRow[]): string[] {
  return uniq(rows.flatMap((r) => (r.to === null ? [r.from] : [r.from, r.to])));
}

/** Estimate codes by block; `Means`, `Intercepts` and the rest are not drawn. */
const BLOCK_CODES: Partial<Record<OutRow['block'], number>> = {
  BY: 1,
  ON: 1,
  WITH: 2,
  'Residual Variances': 4,
  Variances: 5,
};

/** `rows` as `.dgm` estimate rows, with `offset` added to each code (10 for STDYX). */
function estimateRows(rows: OutRow[], offset: number): EstimateRow[] {
  return rows.flatMap((r) => {
    const code = BLOCK_CODES[r.block];
    if (code === undefined) return [];
    const edge = code === 1 || code === 2;
    if (edge !== (r.to !== null)) return [];
    return [
      {
        code: code + offset,
        group: 1,
        from: r.from,
        to: r.to,
        value: r.estimate,
        se: r.se,
        ci: null,
        constraintLabel: null,
      },
    ];
  });
}

/**
 * Label rows for the syntax's labels: 91 for a loading or regression, 92 for
 * a covariance, 94 for a residual variance and 95 for a variance (of a
 * variable that is not a dependent one).
 */
function labelRows(statements: ModelStmt[], dependent: Set<string>, latents: Set<string>): EstimateRow[] {
  const row = (code: number, from: string, to: string | null, label: string): EstimateRow => ({
    code,
    group: 1,
    from: from.toLowerCase(),
    to: to === null ? null : to.toLowerCase(),
    value: null,
    se: null,
    ci: null,
    // Mplus writes labels lower-cased in a `.dgm`'s label rows (`B1` in the
    // input, `b1` in the row), and those rows override the syntax's spelling.
    constraintLabel: label.toLowerCase(),
  });
  return statements.flatMap((s) =>
    s.rhs.flatMap((t) => {
      if (!t.constraint || !t.name) return [];
      if (s.op === 'BY') return [row(91, s.lhs, t.name, t.constraint)];
      if (s.op === 'ON') return [row(91, t.name, s.lhs, t.constraint)];
      if (t.name.toLowerCase() !== s.lhs.toLowerCase()) return [row(92, s.lhs, t.name, t.constraint)];
      // A pin with a label (`y1*0.5 (rv)`): a residual variance when the
      // variable is a dependent one, else a variance. A latent that is
      // regressed on something is dependent too, but the summary does not
      // say which latents are, so only observed dependents count here.
      const name = t.name.toLowerCase();
      const residual = dependent.has(name) && !latents.has(name);
      return [row(residual ? 94 : 95, t.name, null, t.constraint)];
    }),
  );
}

/**
 * MODEL statements rebuilt from the results, for a `.out` without an input
 * echo: one BY statement per factor and one ON statement per dependent.
 * Covariances are left to the estimate rows, which make them COVAR edges,
 * since without the input a declared covariance cannot be told from one
 * Mplus estimates by default.
 */
function statementsFromResults(rows: OutRow[]): ModelStmt[] {
  const statements = new Map<string, ModelStmt>();
  for (const r of rows) {
    if ((r.block !== 'BY' && r.block !== 'ON') || r.to === null) continue;
    const lhs = r.block === 'BY' ? r.from : r.to;
    const name = r.block === 'BY' ? r.to : r.from;
    const key = `${r.block}:${lhs}`;
    let s = statements.get(key);
    if (!s) {
      s = { raw: '', op: r.block, lhs, rhs: [] };
      statements.set(key, s);
    }
    if (!s.rhs.some((t) => t.name === name)) {
      s.rhs.push({ name, free: false, start: null, fixed: null, constraint: null });
    }
  }
  return [...statements.values()];
}

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
