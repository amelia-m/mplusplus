import type { EdgeKind } from '../model/graph.js';
import type { PValueEntry } from '../state/store.js';

/**
 * Number of edges in the current graph that a `.out` file gives a usable
 * p-value for: the key names an edge and at least one of `unstd` / `stdyx`
 * is present. The `.out` map can hold keys for parameters the diagram does
 * not draw (and both orders of a symmetric pair), and entries with neither
 * p-value attach nothing, so its size overstates what was attached.
 */
export function countMatchedPValues(
  pValues: Readonly<Record<string, PValueEntry | undefined>>,
  graph: { edges: ReadonlyArray<{ id: string }> },
): number {
  let n = 0;
  for (const e of graph.edges) {
    if (!Object.prototype.hasOwnProperty.call(pValues, e.id)) continue;
    const entry = pValues[e.id];
    if (entry && (entry.unstd != null || entry.stdyx != null)) n++;
  }
  return n;
}

/**
 * Number of edges in the current graph that the `.out` names at all, with or
 * without a usable p-value. A loading fixed at 1 in a `.out` without
 * standardized results has only Mplus's `999.000` (null), so it attaches
 * nothing, but the `.out` does describe it: it is the same model.
 */
export function countNamedEdges(
  pValues: Readonly<Record<string, PValueEntry | undefined>>,
  graph: { edges: ReadonlyArray<{ id: string }> },
): number {
  return graph.edges.filter((e) => Object.prototype.hasOwnProperty.call(pValues, e.id)).length;
}

/** Directed (BY, ON) and covariance (WITH, COVAR) edges: the kinds a `.out` p-value can name. */
const P_VALUE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['BY', 'ON', 'WITH', 'COVAR']);

/**
 * Number of edges in `graph` that could carry a p-value: the "m" in "n of m
 * edges". Every directed (BY, ON) and covariance (WITH, COVAR) edge counts,
 * fixed ones too: a loading fixed at 1 has no unstandardized p-value (Mplus
 * prints `999.000`), but its STDYX estimate has one, and `countMatchedPValues`
 * counts an edge with either (seen in `sample.out`, the `.out` of syn_sem).
 */
export function countPValueEdges(graph: { edges: ReadonlyArray<{ kind: EdgeKind }> }): number {
  return graph.edges.filter((e) => P_VALUE_KINDS.has(e.kind)).length;
}

/**
 * Regex source for an Mplus command keyword or a shortening of it to four or
 * more letters, as `keyword()` in `parser/dgm.ts` builds.
 */
function keyword(word: string): string {
  let tail = '';
  for (const letter of [...word.slice(4)].reverse()) tail = `(?:${letter}${tail})?`;
  return word.slice(0, 4) + tail;
}

const COMMANDS = ['TITLE', 'DATA', 'VARIABLE', 'DEFINE', 'ANALYSIS', 'MODEL', 'OUTPUT', 'SAVEDATA', 'PLOT', 'MONTECARLO'];

/** A line that starts an Mplus command (`DATA:`, `MODEL CONSTRAINT:`), as in `parser/dgm.ts`. */
const COMMAND_HEADER_RE = new RegExp(`^[ \\t]*(?:${COMMANDS.map(keyword).join('|')})\\b[^:;\\n]*:`, 'i');

/** The TITLE command's own header, capturing the text after its colon. */
const TITLE_HEADER_RE = new RegExp(`^[ \\t]*${keyword('TITLE')}[ \\t]*:(.*)$`, 'i');

/**
 * The Mplus input in `text`: the part of a `.dgm` before `INPUT_END`, or the
 * input echo of a `.out` (after `INPUT INSTRUCTIONS`, up to the line that
 * ends it). Null for a `.out` with no echo (`NOECHO`).
 */
function inputLines(text: string, kind: 'dgm' | 'out'): string[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (kind === 'dgm') {
    const end = lines.findIndex((l) => /^\s*INPUT_END\s*$/.test(l));
    return end < 0 ? lines : lines.slice(0, end);
  }
  const start = lines.findIndex((l) => /^\s*INPUT INSTRUCTIONS\s*$/.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*(?:INPUT READING TERMINATED|\*\*\* (?:WARNING|ERROR))/.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * The TITLE of an Mplus input, as written: the text after `TITLE:` and on
 * the lines after it up to the next command header, comments (`!` to the end
 * of the line) removed, lines trimmed and joined with one space. Null when
 * there is no TITLE command, or it is empty, or a `.out` has no input echo.
 */
export function mplusTitle(text: string, kind: 'dgm' | 'out'): string | null {
  const lines = inputLines(text, kind);
  if (!lines) return null;
  const start = lines.findIndex((l) => TITLE_HEADER_RE.test(l));
  if (start < 0) return null;
  const parts = [TITLE_HEADER_RE.exec(lines[start])![1]];
  for (const line of lines.slice(start + 1)) {
    if (COMMAND_HEADER_RE.test(line)) break;
    parts.push(line);
  }
  const title = parts
    .map((p) => p.replace(/!.*$/, '').trim())
    .filter((p) => p.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ');
  return title.length > 0 ? title : null;
}

/**
 * Whether two titles name different models: both present and different
 * after trimming, collapsing whitespace and case-folding. A missing title on
 * either side is never a difference.
 */
export function titlesDiffer(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  return fold(a) !== fold(b);
}

/** What the notice bar says after a `.out` attached p-values to an open diagram. */
export interface AttachNote {
  text: string;
  /** True when the `.out` may be from another model: shown as a warning. */
  warning: boolean;
}

/**
 * The note for a `.out` (`outName`) that attached p-values to `matched` of
 * the open diagram's (`diagramName`) `attachable` edges (`countPValueEdges`).
 * Call it only when `matched` > 0 (none matching is refused, not attached).
 * It warns when fewer than all edges matched, or when the two files' TITLEs
 * differ (`titlesDiffer`), and says what Undo does. `changed` is false when
 * the diagram already had these very p-values (the same `.out` dropped
 * again, or onto the diagram it was opened as): nothing was added to the
 * undo history then, so the note says they were already attached and does
 * not offer Undo.
 */
export function outAttachNote(args: {
  outName: string;
  diagramName: string;
  matched: number;
  attachable: number;
  outTitle: string | null;
  diagramTitle: string | null;
  changed?: boolean;
  /**
   * Edges the `.out` names at all (`countNamedEdges`), p-value or not; the
   * mismatch warning compares this, not `matched`, so fixed parameters with
   * no p-value do not read as edges from another model. Defaults to `matched`.
   */
  named?: number;
  /** False when Undo will not remove them (a demo, whose history is reset after loading). */
  undoable?: boolean;
}): AttachNote {
  const { outName, diagramName, matched } = args;
  // Never print "20 of 19", should a graph ever hold an edge kind not counted as attachable.
  const attachable = Math.max(args.attachable, matched);
  const some = Math.max(args.named ?? matched, matched) < attachable;
  const otherTitle = titlesDiffer(args.outTitle, args.diagramTitle);
  const changed = args.changed ?? true;
  const head = changed
    ? `Attached p-values from ${outName} to ${diagramName}`
    : `The p-values from ${outName} were already attached to ${diagramName}`;
  const counts = `(${matched} of ${attachable} edges)`;
  const undo = !changed ? 'Nothing changed.' : (args.undoable ?? true) ? 'Undo removes them.' : '';
  const another = 'this .out may be from another model.';
  const titleNote = `its TITLE differs from ${diagramName}'s`;
  if (!some && !otherTitle) return { text: `${head} ${counts}. ${undo}`.trim(), warning: false };
  const onlySome = `only ${matched} of ${attachable} edges matched`;
  const text = !otherTitle
    ? `${head}, but ${onlySome}; ${another} ${undo}`
    : some
      ? `${head}, but ${onlySome} and ${titleNote}; ${another} ${undo}`
      : `${head} ${counts}, but ${titleNote}; ${another} ${undo}`;
  return { text: text.trim(), warning: true };
}
