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
  const variables = generateNamesList(
    parseNamesList(
      cleanedInput,
      new RegExp(`VARIABLE\\s*:\\s*[\\s\\S]*?\\bNAMES${OPTION_ASSIGN}([\\s\\S]*?);`, 'i'),
    ),
  );
  const useVar = expandByPosition(
    parseNamesList(
      cleanedInput,
      new RegExp(`\\bUSEVAR(?:IABLES)?${OPTION_ASSIGN}([\\s\\S]*?);`, 'i'),
    ),
    variables,
  );
  // List order for observed variables in MODEL ranges: USEVARIABLES, or
  // NAMES when there is no USEVARIABLES (see `rangeByPosition`).
  const modelStatements = parseModelBlock(cleanedInput, useVar.length > 0 ? useVar : variables);

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

/**
 * A line that starts an Mplus command: a command keyword at the start of the
 * line, optionally followed by more words (`MODEL CONSTRAINT`, `DATA
 * IMPUTATION`, `MODEL g2`), then a colon. Mplus itself reads such a line as
 * a new command, so it ends whatever section came before it. Model
 * statements never contain a colon, so they cannot match.
 */
const SECTION_HEADER_RE =
  /^[ \t]*(?:TITLE|DATA|VARIABLE|DEFINE|ANALYSIS|MODEL|OUTPUT|SAVEDATA|PLOT|MONTECARLO)\b[^:;\n]*:/im;

/** The `MODEL:` command itself, at the start of a line. */
const MODEL_HEADER_RE = /^[ \t]*MODEL[ \t]*:/im;

/** A MODEL statement split at its operator, before list ranges are expanded. */
interface SplitStmt {
  raw: string;
  /** `null` for a statement without BY / ON / WITH (a variance pin such as `f@1`). */
  op: ModelOp | null;
  lhs: ModelTerm[];
  rhs: ModelTerm[];
}

/**
 * Parse the MODEL block. `observedOrder` is the list order of observed
 * variables, used to expand list ranges such as `y1-y3`.
 */
function parseModelBlock(text: string, observedOrder: string[]): ModelStmt[] {
  // The MODEL block runs from `MODEL:` to the next command header
  // (`MODEL CONSTRAINT:`, `OUTPUT:`, ...) or the end of the input section.
  const m = MODEL_HEADER_RE.exec(text);
  if (!m) return [];
  const rest = text.slice(m.index + m[0].length);
  const next = SECTION_HEADER_RE.exec(rest);
  const body = next ? rest.slice(0, next.index) : rest;

  // Split on `;` while ignoring inline whitespace/newlines. Each "statement"
  // ends in `;`. Discard empty fragments.
  const statements = body
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0)
    .map(splitStatement);

  // Latents are ordered by their BY statements, wherever a range naming
  // them appears (User's Guide v8, ch. 17 p. 731), so collect them first.
  const latentOrder = uniqIgnoreCase(
    statements.filter((s) => s.op === 'BY' && s.lhs.length > 0).map((s) => s.lhs[0].name),
  );
  const resolve: RangeResolver = (first, last) =>
    rangeByPosition(first, last, observedOrder) ?? rangeByPosition(first, last, latentOrder);

  const out: ModelStmt[] = [];
  for (const s of statements) {
    if (s.op === null) {
      // Standalone like `f@1` or `Y1@0.01` - store as a synthetic WITH-self
      // entry so callers can recover the variance/pin if they care. We model
      // these as a single-term "WITH" statement against itself with the pin.
      for (const self of parsePinStatement(s.raw, resolve)) {
        out.push({ raw: s.raw, op: 'WITH', lhs: self.name, rhs: [self] });
      }
      continue;
    }
    // A range may stand on either side of ON and WITH but only on the right
    // of BY (ch. 17 p. 731): the left of BY is the one latent it defines.
    const rhs = expandTerms(s.rhs, resolve);
    if (s.op === 'BY') {
      out.push({ raw: s.raw, op: s.op, lhs: s.lhs[0]?.name ?? '', rhs });
    } else {
      // Expand `a b ON c d` (and `a1-a3 ON c`) into one statement per LHS so
      // consumers can iterate edges trivially. RHS is shared.
      for (const l of expandTerms(s.lhs, resolve)) {
        out.push({ raw: s.raw, op: s.op, lhs: l.name, rhs });
      }
    }
  }
  return out;
}

/** Split one flattened MODEL statement at its BY / ON / WITH operator. */
function splitStatement(flat: string): SplitStmt {
  // Detect operator. Match BY / ON / WITH as whole words, case-insensitive.
  const opMatch = /\s(BY|ON|WITH)\s/i.exec(' ' + flat + ' ');
  if (!opMatch) return { raw: flat, op: null, lhs: [], rhs: [] };

  const op = opMatch[1].toUpperCase() as ModelOp;
  // Split exactly once on the operator with surrounding spaces.
  const opRe = new RegExp(`\\s${op}\\s`, 'i');
  const idx = flat.search(opRe);
  const lhsPart = flat.slice(0, idx).trim();
  const rhsPart = flat.slice(idx).replace(opRe, '').trim();

  // Mplus allows multiple LHS for ON/WITH (e.g. `x1 x2 ON f`).
  // For BY there is exactly one latent.
  return { raw: flat, op, lhs: parseTermList(lhsPart), rhs: parseTermList(rhsPart) };
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

/** A modifier value written as its own token: a plain decimal number, optionally signed. */
const MODIFIER_VALUE_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;

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
 * statement must be a single term carrying at least one `*` or `@` modifier
 * outside any `(label)`. A list range (`f1-f3@1`) gives one pin per variable
 * it denotes (User's Guide v8, ch. 17 p. 736). Anything else (a bare name, a
 * name with only a label such as `y3 (a*0.5)`, a list of names, a range that
 * cannot be resolved, an intercept in brackets) is not a pin and yields no
 * terms.
 */
function parsePinStatement(s: string, resolve: RangeResolver): ModelTerm[] {
  if (!/[*@]/.test(s.replace(/\([^)]*\)/g, ''))) return [];
  const terms = parseTermList(s);
  if (terms.length !== 1) return [];
  const pins = expandTerms(terms, resolve);
  return pins.every((t) => IDENT_RE.test(t.name)) ? pins : [];
}

// ---------- list ranges ----------
//
// Mplus's list function (User's Guide v8, ch. 17 "Convenience features for
// the MODEL command", pp. 730-732): a hyphen between two names denotes every
// variable from the first to the last, by position in a list order.
// - Observed variables: the USEVARIABLES order, or NAMES when there is no
//   USEVARIABLES. Ch. 17 p. 730 says NAMES order is used when every NAMES
//   variable is analysed; ch. 15 pp. 599-600 says USEVARIABLES order decides.
//   Mplus 8.11 follows USEVARIABLES in that case too (probe 2026-10-22:
//   `USEVARIABLES = k1 k4 k2 k3 k5`, `fk BY k1-k3` loads on k1 k4 k2 k3).
// - Continuous latents: the order of their BY statements (p. 731).
// - A range may appear on both sides of ON and WITH and on the right of BY;
//   a modifier or label after it applies to each variable (pp. 733, 736-737).
// - In NAMES, a range generates names instead (ch. 15 p. 597); in
//   USEVARIABLES it is resolved by NAMES position.
// A range that cannot be resolved (an endpoint not in the list, a reversed
// range, which Mplus 8.11 rejects, or a span from an observed variable to a
// latent, which the Guide does not describe) is kept as written.

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** `first-last`: two names joined by a hyphen, with no spaces. */
const RANGE_RE = /^([A-Za-z_][A-Za-z0-9_]*)-([A-Za-z_][A-Za-z0-9_]*)$/;

/** The names a list range `first-last` denotes, or `null` if it cannot be resolved. */
type RangeResolver = (first: string, last: string) => string[] | null;

function splitRange(token: string): [string, string] | null {
  const m = RANGE_RE.exec(token);
  return m ? [m[1], m[2]] : null;
}

/**
 * The variables from `first` to `last` by position in `order` (case-
 * insensitive), spelled as in `order`; `null` if either end is missing or
 * `last` comes before `first`.
 */
function rangeByPosition(first: string, last: string, order: string[]): string[] | null {
  const lowered = order.map((n) => n.toLowerCase());
  const a = lowered.indexOf(first.toLowerCase());
  const b = lowered.indexOf(last.toLowerCase());
  if (a < 0 || b < 0 || a > b) return null;
  return order.slice(a, b + 1);
}

/** Expand each range token in a list by position in `order`. */
function expandByPosition(tokens: string[], order: string[]): string[] {
  return tokens.flatMap((t) => {
    const r = splitRange(t);
    return (r && rangeByPosition(r[0], r[1], order)) ?? [t];
  });
}

/**
 * Replace each range term with one copy per variable it denotes, carrying
 * the term's modifiers and label to every copy.
 */
function expandTerms(terms: ModelTerm[], resolve: RangeResolver): ModelTerm[] {
  return terms.flatMap((term) => {
    const r = splitRange(term.name);
    const names = r ? resolve(r[0], r[1]) : null;
    return names ? names.map((name) => ({ ...term, name })) : [term];
  });
}

/** Expand the ranges in a NAMES list into the names they generate. */
function generateNamesList(tokens: string[]): string[] {
  return tokens.flatMap((t) => {
    const r = splitRange(t);
    return (r && generateNames(r[0], r[1])) ?? [t];
  });
}

/**
 * The names a NAMES range generates (User's Guide v8, ch. 15 p. 597):
 * `y1-y5` gives y1 to y5, `itema-itemd` gives itema to itemd. Numbers keep
 * the width of the first one (`k08-k10` gives k08 k09 k10; Mplus 8.11
 * probe). `null` when the two names do not share a stem or run backwards.
 */
function generateNames(first: string, last: string): string[] | null {
  const numbered = /^(.*?)(\d+)$/;
  const a = numbered.exec(first);
  const b = numbered.exec(last);
  if (a && b) {
    const from = Number(a[2]);
    const to = Number(b[2]);
    if (a[1].toLowerCase() !== b[1].toLowerCase() || from > to) return null;
    const out: string[] = [];
    for (let n = from; n <= to; n++) out.push(a[1] + String(n).padStart(a[2].length, '0'));
    return out;
  }
  // Lettered: same stem, a single final letter that runs forwards.
  const stem = first.slice(0, -1);
  const fromCh = first.slice(-1).toLowerCase();
  const toCh = last.slice(-1).toLowerCase();
  const lettered =
    !a &&
    !b &&
    first.length === last.length &&
    stem.toLowerCase() === last.slice(0, -1).toLowerCase() &&
    /[a-z]/.test(fromCh) &&
    /[a-z]/.test(toCh) &&
    fromCh <= toCh;
  if (!lettered) return null;
  const upper = first.slice(-1) !== fromCh;
  const out: string[] = [];
  for (let c = fromCh.charCodeAt(0); c <= toCh.charCodeAt(0); c++) {
    const ch = String.fromCharCode(c);
    out.push(stem + (upper ? ch.toUpperCase() : ch));
  }
  return out;
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

  const found =
    readGroupingsCount(lines, i, allVariables.length) ?? scanForGroupingsCount(lines, i);
  // Without a groupings count the rest of the header cannot be told apart
  // from estimate rows, so nothing more is read.
  const groupCount = found?.count ?? null;
  i = found?.next ?? lines.length;

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

/** Where the groupings count is: its value and the index of the line after it. */
interface GroupingsCount {
  count: number;
  next: number;
}

/**
 * Read the groupings count from the fixed header layout that follows the
 * variable list:
 *
 *     <int>                one line
 *     <code code ...>      one integer type code per variable
 *     0                    single-integer lines; the last one is
 *     <N>                  the number of latent groupings (0 with no latents)
 *     <latent> / <obs1 obs2 ...>   N pairs, then the estimate rows
 *
 * Every .dgm checked on 2026-10-22 has this layout: the fixtures in `dgm/`
 * (Mplus 8.11), local runs of User's Guide examples and of a public
 * replication package. `null` when the header does not, so the caller can
 * fall back.
 */
function readGroupingsCount(
  lines: string[],
  start: number,
  variableCount: number,
): GroupingsCount | null {
  let i = start;
  if (!/^\d+$/.test(lines[i] ?? '')) return null;
  i++;
  const codes = (lines[i] ?? '').split(/\s+/);
  if (codes.length !== variableCount || !codes.every((t) => /^-?\d+$/.test(t))) return null;
  i++;
  let count: number | null = null;
  while (i < lines.length && /^\d+$/.test(lines[i])) count = Number(lines[i++]);
  if (count == null) return null;
  // A latent name must follow a non-zero count.
  if (count > 0 && !/^[A-Za-z_]/.test(lines[i] ?? '')) return null;
  return { count, next: i };
}

/**
 * Fallback for a header that does not have the layout `readGroupingsCount`
 * expects: the first single-integer line followed by a latent name and a
 * list of names. It cannot find a count of 0.
 */
function scanForGroupingsCount(lines: string[], start: number): GroupingsCount | null {
  for (let i = start; i + 2 < lines.length; i++) {
    if (
      /^\d+$/.test(lines[i]) &&
      /^[A-Za-z_]/.test(lines[i + 1]) &&
      looksLikeVariableList(lines[i + 2])
    ) {
      return { count: Number(lines[i]), next: i + 1 };
    }
  }
  return null;
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

/** Names without repeats, compared case-insensitively; the first spelling wins. */
function uniqIgnoreCase(xs: string[]): string[] {
  const seen = new Set<string>();
  return xs.filter((x) => {
    const key = x.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
