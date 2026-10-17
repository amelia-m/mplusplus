/**
 * Parser for Mplus `.dgm` (diagrammer) files.
 *
 * A .dgm file has two sections:
 *   1) Mplus syntax block, terminated by a literal line `INPUT_END`.
 *   2) A numeric estimate table.
 *
 * Section 2 starts with a small fixed-format header containing model meta-data
 * and a per-group block listing each latent and the observed variables it
 * loads on. After that header come the estimate rows of the form:
 *
 *     <code> <group> <from> <to> <estimate> <SE>
 *
 * with two notable variants:
 *   - residual variance / latent variance rows have only 4 numbers after the
 *     code: `<code> <group> <var> <estimate> <SE>` (no `to`).
 *   - constraint-label rows (code 91) have the form
 *     `91 <group> <from> <to> <constraintLabel>` with no SE.
 */

export type ModelOp = 'BY' | 'ON' | 'WITH';

export interface ModelStmt {
  /** Original line (verbatim) for round-tripping. */
  raw: string;
  op: ModelOp;
  /** Left-hand side (for BY: latent; for ON: dependent; for WITH: lhs). */
  lhs: string;
  /** Each indicator/predictor with its modifiers. */
  rhs: ModelTerm[];
}

export interface ModelTerm {
  name: string;
  /** Literal `*` flag = freely estimated (default-loaded marker). */
  free: boolean;
  /** Start value from `*<value>` (e.g. `y2*0.8`); `null` for a bare `*` or no `*`. */
  start: number | null;
  /** Literal `@<value>` pin (e.g. `@1`, `@0.01`). */
  fixed: number | null;
  /** Literal `(label)` for equality constraint, e.g. `(cv)`, `(f2)`. */
  constraint: string | null;
}

export type EstimateCode = number;

export interface EstimateRow {
  code: EstimateCode;
  group: number;
  from: string;
  /** `null` for residual/variance rows that only describe a single variable. */
  to: string | null;
  /** Numeric estimate. `null` for constraint-label rows (code 91). */
  value: number | null;
  /** Standard error. `null` for constraint-label rows. */
  se: number | null;
  /** Constraint label, only set for code 91 rows. */
  constraintLabel: string | null;
}

export interface DgmHeader {
  /** Names of every variable (observed + latent) in the model, lower-cased
   *  as Mplus emits them in the post-INPUT_END table. */
  allVariables: string[];
  /** Latents with the observed indicators they load on, in file order. */
  groupings: { latent: string; observed: string[] }[];
}

export interface DgmFile {
  /** Verbatim text from start of file through (and including) `INPUT_END`. */
  inputBlock: string;
  variables: string[];
  useVar: string[];
  modelStatements: ModelStmt[];
  header: DgmHeader;
  estimates: EstimateRow[];
  /** Convenience: latents from the post-INPUT_END groupings header. */
  latents: string[];
  /** Convenience: observed variables (members of any grouping). */
  observed: string[];
}

const INPUT_END_RE = /^\s*INPUT_END\s*$/m;

/**
 * Regex source for the separator between an Mplus option name and its value.
 * Mplus accepts `=`, `ARE` and `IS` interchangeably (`NAMES = ...`,
 * `NAMES ARE ...`, `NAMES IS ...`). The word forms need whitespace on both
 * sides so a value starting with e.g. `arena` is not mistaken for `ARE`.
 */
const OPTION_ASSIGN = String.raw`(?:\s*=\s*|\s+(?:ARE|IS)\s+)`;

export function parseDgm(text: string): DgmFile {
  const split = splitOnInputEnd(text);
  const inputBlock = split.before + 'INPUT_END\n';

  const cleanedInput = stripCommentsAndJoin(split.before);
  const variables = parseNamesList(
    cleanedInput,
    new RegExp(`VARIABLE\\s*:\\s*[\\s\\S]*?\\bNAMES${OPTION_ASSIGN}([\\s\\S]*?);`, 'i'),
  );
  const useVar = parseNamesList(
    cleanedInput,
    new RegExp(`\\bUSEVAR(?:IABLES)?${OPTION_ASSIGN}([\\s\\S]*?);`, 'i'),
  );
  const modelStatements = parseModelBlock(cleanedInput);

  const { header, estimates } = parseEstimateSection(split.after);

  const latents = header.groupings.map((g) => g.latent);
  const observed = uniq(header.groupings.flatMap((g) => g.observed));

  return {
    inputBlock,
    variables,
    useVar,
    modelStatements,
    header,
    estimates,
    latents,
    observed,
  };
}

// ---------- syntax-block parsing ----------

function splitOnInputEnd(text: string): { before: string; after: string } {
  const match = INPUT_END_RE.exec(text);
  if (!match) {
    throw new Error('Missing INPUT_END marker; not a valid .dgm file.');
  }
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  return { before, after };
}

/**
 * Strip Mplus comments (`!` to end of line) and normalize line endings.
 * The cleaned text is still line-oriented so other regexes work normally.
 */
function stripCommentsAndJoin(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/!.*$/, ''))
    .join('\n');
}

function parseNamesList(text: string, re: RegExp): string[] {
  const m = re.exec(text);
  if (!m) return [];
  return m[1]
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseModelBlock(text: string): ModelStmt[] {
  // The MODEL block runs from `MODEL:` to the next top-level section header
  // (e.g. nothing - block ends at end of input section). Consume to end.
  const headerRe = /MODEL\s*:\s*/i;
  const m = headerRe.exec(text);
  if (!m) return [];
  const body = text.slice(m.index + m[0].length);

  // Split on `;` while ignoring inline whitespace/newlines. Each "statement"
  // ends in `;`. Discard empty fragments.
  const statements = body.split(';').map((s) => s.trim()).filter((s) => s.length > 0);

  const out: ModelStmt[] = [];
  for (const raw of statements) {
    const flat = raw.replace(/\s+/g, ' ').trim();
    if (!flat) continue;

    // Detect operator. Match BY / ON / WITH as whole words, case-insensitive.
    const opMatch = /\s(BY|ON|WITH)\s/i.exec(' ' + flat + ' ');
    if (!opMatch) {
      // Standalone like `f@1` or `Y1@0.01` - store as a synthetic WITH-self
      // entry so callers can recover the variance/pin if they care. We model
      // these as a single-term "WITH" statement against itself with the pin.
      const self = parsePinStatement(flat);
      if (self) out.push({ raw: flat, op: 'WITH', lhs: self.name, rhs: [self] });
      continue;
    }

    const op = opMatch[1].toUpperCase() as ModelOp;
    // Split exactly once on the operator with surrounding spaces.
    const opRe = new RegExp(`\\s${op}\\s`, 'i');
    const idx = flat.search(opRe);
    const lhsPart = flat.slice(0, idx).trim();
    const rhsPart = flat.slice(idx).replace(opRe, '').trim();

    // Mplus allows multiple LHS for ON/WITH (e.g. `x1 x2 ON f`).
    // For BY there is exactly one latent.
    const lhsTerms = parseTermList(lhsPart);
    const rhsTerms = parseTermList(rhsPart);

    if (op === 'BY') {
      out.push({ raw: flat, op, lhs: lhsTerms[0]?.name ?? '', rhs: rhsTerms });
    } else {
      // Expand `a b ON c d` into one statement per LHS so consumers can iterate
      // edges trivially. RHS is shared.
      for (const l of lhsTerms) {
        out.push({ raw: flat, op, lhs: l.name, rhs: rhsTerms });
      }
    }
  }
  return out;
}

/**
 * Parse a list of terms like `y1* y2 y3`, `y2*0.8` or
 * `y1* y2 (la) y3 (lb)`. Whitespace is the separator; modifiers
 * (`*`, `*<start>`, `@<value>`, `(label)`) attach to the preceding name,
 * whether glued on (`y2*0.8`) or written as their own token (`y2 @1`).
 * A number written as its own token directly after a valueless `*` or `@`
 * (`y2@ 1`, `y2 * 0.8`) is that modifier's value: Mplus variable names start
 * with a letter, so such a token is never a variable.
 */
function parseTermList(s: string): ModelTerm[] {
  const tokens = tokenizeTerms(s);
  const terms: ModelTerm[] = [];
  let current: ModelTerm | null = null;
  // The modifier of the previous token if it was left without a value.
  let pending: Modifier | null = null;

  for (const tok of tokens) {
    if (tok.startsWith('(') && tok.endsWith(')')) {
      if (current) current.constraint = tok.slice(1, -1).trim();
      pending = null;
      continue;
    }
    // Split `name` from any glued-on `*...` / `@...` modifiers. A token that
    // is only modifiers (e.g. a standalone `@1`) belongs to the previous term.
    const m = /^([^*@]*)(.*)$/.exec(tok)!;
    const name = m[1];
    const modifiers = m[2];
    if (current && pending && MODIFIER_VALUE_RE.test(name)) {
      setModifier(current, pending, name);
      pending = applyModifiers(current, modifiers);
      continue;
    }
    if (!name) {
      pending = current ? applyModifiers(current, modifiers) : null;
      continue;
    }

    current = { name, free: false, start: null, fixed: null, constraint: null };
    pending = applyModifiers(current, modifiers);
    terms.push(current);
  }
  return terms;
}

type Modifier = '*' | '@';

/** A modifier value written as its own token: a plain decimal number. */
const MODIFIER_VALUE_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Apply a modifier suffix such as `*`, `*0.8`, `@1` or `*0.5@1` to a term.
 * `*` marks the parameter free, with an optional start value; `@` fixes it.
 * Returns the last modifier if it had no value (so a following number token
 * can supply it), otherwise `null`.
 */
function applyModifiers(term: ModelTerm, suffix: string): Modifier | null {
  const re = /([*@])([^*@]*)/g;
  let pending: Modifier | null = null;
  for (let m = re.exec(suffix); m; m = re.exec(suffix)) {
    const op = m[1] as Modifier;
    const value = m[2].trim();
    setModifier(term, op, value);
    pending = value === '' ? op : null;
  }
  return pending;
}

/** Set one modifier on a term; `value` may be empty (bare `*` or `@`). */
function setModifier(term: ModelTerm, op: Modifier, value: string): void {
  if (op === '*') {
    term.free = true;
    term.start = parseOptionalNumber(value);
  } else {
    term.fixed = parseOptionalNumber(value);
  }
}

/** `null` for an empty or non-numeric string, otherwise the number. */
function parseOptionalNumber(s: string): number | null {
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a term string into atomic tokens. Parenthesized groups stay intact
 * so the caller can recognize `(label)` modifiers, even when there is no
 * space between the previous name and the opening `(`.
 */
function tokenizeTerms(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '(') {
      const close = s.indexOf(')', i);
      if (close < 0) {
        out.push(s.slice(i));
        return out;
      }
      out.push(s.slice(i, close + 1));
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < n && !/\s/.test(s[j]) && s[j] !== '(') j++;
    out.push(s.slice(i, j));
    i = j;
  }
  return out;
}

/**
 * Parse a free-standing pin like `Y1@0.01`, `f@1`, `f*0.5` or
 * `y1*0.5@1`, using the same modifier grammar as `parseTermList`. The
 * statement must be a single identifier-shaped term carrying at least one
 * `*` or `@` modifier; anything else (a bare name, a list, a range such as
 * `y1-y3@1`, an intercept in brackets) is not a pin and yields `null`.
 */
function parsePinStatement(s: string): ModelTerm | null {
  if (!/[*@]/.test(s)) return null;
  const terms = parseTermList(s);
  if (terms.length !== 1) return null;
  const [term] = terms;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(term.name) ? term : null;
}

// ---------- estimate-section parsing ----------

interface ParsedSection {
  header: DgmHeader;
  estimates: EstimateRow[];
}

function parseEstimateSection(text: string): ParsedSection {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let i = 0;
  // Skip the small fixed-format prefix until we find the line containing every
  // variable name. We detect it as: the first line whose tokens are >1 and all
  // tokens are identifier-shaped (letters/digits/underscore). This is robust
  // against version drift in the integer prefix.
  while (i < lines.length && !looksLikeVariableList(lines[i])) i++;

  if (i >= lines.length) {
    throw new Error('Could not locate variable-list line in post-INPUT_END section.');
  }
  const allVariables = lines[i].split(/\s+/);
  i++;

  // Skip a few more numeric/header lines until the groupings count.
  // After the variable list we expect:
  //   <some int>    (number of "structural" things - varies)
  //   <int int int ...>   (per-variable type codes)
  //   <0>
  //   <N>           (number of latent groupings)
  //   <latent>
  //   <obs1 obs2 ...>
  //   ...
  // Strategy: scan forward for a single-int line followed by an alpha-line.
  // The single-int IS the groupings count.
  let groupCount: number | null = null;
  while (i < lines.length) {
    if (/^\d+$/.test(lines[i]) && i + 1 < lines.length && /^[A-Za-z_]/.test(lines[i + 1])) {
      // Peek ahead: the line after `<latent>` must look like a list of names.
      const candidateCount = Number(lines[i]);
      if (i + 2 < lines.length && looksLikeVariableList(lines[i + 2])) {
        groupCount = candidateCount;
        i++;
        break;
      }
    }
    i++;
  }

  const groupings: DgmHeader['groupings'] = [];
  if (groupCount != null) {
    for (let g = 0; g < groupCount && i + 1 < lines.length; g++) {
      const latent = lines[i];
      const observed = lines[i + 1].split(/\s+/);
      groupings.push({ latent, observed });
      i += 2;
    }
  }

  // Remaining lines are estimate rows. Each starts with an integer code.
  const estimates: EstimateRow[] = [];
  for (; i < lines.length; i++) {
    const row = parseEstimateRow(lines[i]);
    if (row) estimates.push(row);
  }

  return { header: { allVariables, groupings }, estimates };
}

function looksLikeVariableList(line: string): boolean {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return false;
  return tokens.every((t) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(t));
}

const NUM_RE = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

function parseEstimateRow(line: string): EstimateRow | null {
  const tokens = line.split(/\s+/);
  if (tokens.length < 4) return null;

  const code = Number(tokens[0]);
  const group = Number(tokens[1]);
  if (!Number.isFinite(code) || !Number.isFinite(group)) return null;

  // Constraint-label row: `91 group from to label` (no SE; label is non-numeric).
  if (code === 91) {
    if (tokens.length < 5) return null;
    return {
      code,
      group,
      from: tokens[2],
      to: tokens[3],
      value: null,
      se: null,
      constraintLabel: tokens.slice(4).join(' '),
    };
  }

  // Otherwise, the trailing tokens are numeric. There are two layouts:
  //   <code> <group> <from> <to> <est> <se>      (6 tokens, est-style)
  //   <code> <group> <var>          <est> <se>   (5 tokens, residual/var-style)
  if (tokens.length === 6 && NUM_RE.test(tokens[4]) && NUM_RE.test(tokens[5])) {
    return {
      code,
      group,
      from: tokens[2],
      to: tokens[3],
      value: Number(tokens[4]),
      se: Number(tokens[5]),
      constraintLabel: null,
    };
  }
  if (tokens.length === 5 && NUM_RE.test(tokens[3]) && NUM_RE.test(tokens[4])) {
    return {
      code,
      group,
      from: tokens[2],
      to: null,
      value: Number(tokens[3]),
      se: Number(tokens[4]),
      constraintLabel: null,
    };
  }
  // Unknown shape - skip rather than throw, to be tolerant of corpus drift.
  return null;
}

// ---------- utils ----------

function uniq<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}
