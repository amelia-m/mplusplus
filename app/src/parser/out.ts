/**
 * Parser for Mplus `.out` files. We only extract the rows needed to attach
 * p-values to graph edges: `MODEL RESULTS` (unstandardized) and
 * `STANDARDIZED MODEL RESULTS (STDYX Standardization)`.
 *
 * The strategy is intentionally robust to column-position drift across Mplus
 * versions: rather than slicing fixed columns, we identify rows by matching
 * 4 trailing numeric tokens (estimate, SE, est/SE, p-value) and treat the
 * remaining leading text as the indicator name.
 */

export type OutBlock = 'BY' | 'ON' | 'WITH' | 'Means' | 'Intercepts' | 'Variances' | 'Residual Variances' | 'Thresholds' | 'Other';

export interface OutRow {
  section: 'unstd' | 'stdyx';
  block: OutBlock;
  /** For BY: the latent. For ON: the predictor (graph direction, reversed
   *  from Mplus syntax). For WITH: lhs of WITH. For variance-style rows
   *  (Means/Intercepts/Variances/Residuals): the variable itself. Always
   *  lower-cased. */
  from: string;
  /** For BY: the indicator. For ON: the dependent. For WITH: rhs of WITH.
   *  `null` for variance-style rows. Always lower-cased. */
  to: string | null;
  estimate: number;
  se: number;
  estDivSE: number;
  /** Two-tailed p-value in [0, 1]. `null` when Mplus prints a value outside
   *  that range, notably the `999.000` placeholder for fixed parameters. */
  pValue: number | null;
}

export interface ParsedOut {
  unstd: OutRow[];
  stdyx: OutRow[];
}

/**
 * Report headers that start a section. Real Mplus output (v8) prints
 * `STANDARDIZED MODEL RESULTS` on its own line, then `STDYX Standardization`,
 * `STDY Standardization` and `STD Standardization` as separate subsections;
 * an older single-line form names STDYX on the same line. Only unstandardized
 * and STDYX rows are kept: the other headers are boundaries (`skip`), so STDY
 * and STD rows never fold into STDYX.
 */
const SECTION_HEADERS: { re: RegExp; section: 'unstd' | 'stdyx' | 'skip' }[] = [
  { re: /^STANDARDIZED MODEL RESULTS\b.*\bSTDYX\b/i, section: 'stdyx' },
  { re: /^STANDARDIZED MODEL RESULTS\s*$/i, section: 'skip' },
  { re: /^STDYX Standardization\s*$/i, section: 'stdyx' },
  { re: /^STDY Standardization\s*$/i, section: 'skip' },
  { re: /^STD Standardization\s*$/i, section: 'skip' },
  { re: /^R-SQUARE\s*$/i, section: 'skip' },
  { re: /^MODEL RESULTS\s*$/i, section: 'unstd' },
];

const BLOCK_KEYWORDS: { keyword: RegExp; block: OutBlock }[] = [
  { keyword: /^BY$/i, block: 'BY' },
  { keyword: /^ON$/i, block: 'ON' },
  { keyword: /^WITH$/i, block: 'WITH' },
];

const STANDALONE_BLOCK_HEADERS: { re: RegExp; block: OutBlock }[] = [
  { re: /^Means\s*$/i, block: 'Means' },
  { re: /^Intercepts\s*$/i, block: 'Intercepts' },
  { re: /^Thresholds\s*$/i, block: 'Thresholds' },
  { re: /^Variances\s*$/i, block: 'Variances' },
  { re: /^Residual\s+Variances\s*$/i, block: 'Residual Variances' },
];

const NUM = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;

export function parseOut(text: string): ParsedOut {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  const sectionStarts: { idx: number; section: 'unstd' | 'stdyx' | 'skip' }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    for (const h of SECTION_HEADERS) {
      if (h.re.test(trimmed)) {
        sectionStarts.push({ idx: i, section: h.section });
        break;
      }
    }
  }

  const out: ParsedOut = { unstd: [], stdyx: [] };

  for (let s = 0; s < sectionStarts.length; s++) {
    const { idx: start, section } = sectionStarts[s];
    if (section === 'skip') continue;
    const end = s + 1 < sectionStarts.length ? sectionStarts[s + 1].idx : lines.length;
    const sectionLines = lines.slice(start + 1, end);
    const rows = parseSection(sectionLines, section);
    if (section === 'unstd') out.unstd.push(...rows);
    else out.stdyx.push(...rows);
  }

  return out;
}

function parseSection(lines: string[], section: 'unstd' | 'stdyx'): OutRow[] {
  const rows: OutRow[] = [];
  // Track a small state machine: leading-name (e.g. "F1") establishes a
  // group; the very next non-blank line is the block keyword (BY/ON/WITH).
  // Children rows under that group are the indented numeric rows. Standalone
  // section headers ("Intercepts", "Variances", etc.) reset the group.
  let groupName: string | null = null;
  let pendingBlock: OutBlock | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // Stop at the next major report section.
    if (
      /^QUALITY OF NUMERICAL RESULTS\b/i.test(trimmed) ||
      /^TECHNICAL\b/i.test(trimmed) ||
      /^MODEL FIT\b/i.test(trimmed) ||
      /^MODEL MODIFICATION INDICES\b/i.test(trimmed)
    ) {
      break;
    }

    // Skip the column-header rows.
    if (/^Estimate\b/i.test(trimmed) && /S\.E\./.test(trimmed)) continue;
    if (/^Two-Tailed/i.test(trimmed)) continue;
    if (/^P-Value/i.test(trimmed)) continue;

    // Standalone block headers reset group/block.
    let standalone: OutBlock | null = null;
    for (const h of STANDALONE_BLOCK_HEADERS) {
      if (h.re.test(trimmed)) {
        standalone = h.block;
        break;
      }
    }
    if (standalone) {
      groupName = null;
      pendingBlock = standalone;
      continue;
    }

    // "GROUP <name>" headers in multi-group output reset the group state.
    if (/^Group\s+\S+/i.test(trimmed)) {
      groupName = null;
      pendingBlock = null;
      continue;
    }

    // Detect the form `<NAME>` immediately followed (next non-blank line) by
    // `BY`/`ON`/`WITH`. That happens when the indicator label is on its own
    // line in fixed-format output. We also accept `<NAME> BY` on a single line.
    const tokens = trimmed.split(/\s+/);

    // Single-token line that is an identifier - could be a group name (F1)
    // or a variance-style variable. Look ahead for BY/ON/WITH.
    if (tokens.length === 1 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(tokens[0])) {
      const next = lines.slice(i + 1).find((l) => l.trim().length > 0);
      const nextTrim = next?.trim() ?? '';
      const blockMatch = BLOCK_KEYWORDS.find((b) => b.keyword.test(nextTrim));
      if (blockMatch) {
        groupName = tokens[0];
        pendingBlock = blockMatch.block;
        // skip to the keyword line
        while (i + 1 < lines.length && lines[i + 1].trim() !== nextTrim) i++;
        i++; // consume the keyword line
        continue;
      }
      // Else ignore - likely a stray title row.
      continue;
    }

    // `<NAME> BY` / `<NAME> ON` / `<NAME> WITH` single-line variant.
    if (tokens.length === 2) {
      const blk = BLOCK_KEYWORDS.find((b) => b.keyword.test(tokens[1]));
      if (blk) {
        groupName = tokens[0];
        pendingBlock = blk.block;
        continue;
      }
    }

    // Otherwise this should be a data row: <name> <est> <se> <est/se> <p>.
    const row = parseDataRow(tokens);
    if (!row) continue;

    let block: OutBlock = pendingBlock ?? 'Other';
    let from: string;
    let to: string | null;

    if (block === 'BY' || block === 'ON' || block === 'WITH') {
      if (!groupName) continue;
      // ON: dependent (groupName) regressed on rhs predictor (row.name).
      // BY: latent (groupName) -> indicator (row.name).
      // WITH: lhs (groupName) <-> rhs (row.name).
      from = block === 'ON' ? row.name : groupName;
      to = block === 'ON' ? groupName : row.name;
    } else {
      from = row.name;
      to = null;
    }

    rows.push({
      section,
      block,
      from: from.toLowerCase(),
      to: to == null ? null : to.toLowerCase(),
      estimate: row.estimate,
      se: row.se,
      estDivSE: row.estDivSE,
      pValue: row.pValue,
    });
  }

  return rows;
}

interface DataRow {
  name: string;
  estimate: number;
  se: number;
  estDivSE: number;
  pValue: number | null;
}

/**
 * A p-value is a probability: keep values in [0, 1] (both ends inclusive)
 * and map anything else to `null` ("no p-value"). Mplus prints `999.000`
 * for parameters that are fixed rather than estimated; treating that as a
 * real p-value would mark every fixed loading "not significant".
 */
function toProbability(n: number): number | null {
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

function parseDataRow(tokens: string[]): DataRow | null {
  if (tokens.length < 5) return null;
  // Match the trailing 4 numeric tokens.
  const n = tokens.length;
  const last4 = tokens.slice(n - 4);
  if (!last4.every((t) => NUM.test(t))) return null;
  const [estStr, seStr, esStr, pStr] = last4;
  const name = tokens.slice(0, n - 4).join('_'); // names never have spaces in Mplus
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
  return {
    name,
    estimate: Number(estStr),
    se: Number(seStr),
    estDivSE: Number(esStr),
    pValue: toProbability(Number(pStr)),
  };
}

/**
 * Build a per-edge p-value lookup from a parsed `.out`. Keyed by an edge id
 * convention `${kind}:${from}->${to}` matching `model/graph.ts`. WITH rows
 * are recorded under both orderings, and under both the `WITH` and `COVAR`
 * kinds: the graph keeps one edge per unordered pair (oriented by its first
 * declaration) and synthesizes `COVAR` for covariances the syntax did not
 * declare, so the consumer can hit the edge whichever form it took.
 */
export function buildPValueMap(parsed: ParsedOut): Record<
  string,
  { unstd: number | null; stdyx: number | null }
> {
  const out: Record<string, { unstd: number | null; stdyx: number | null }> = {};
  const ensure = (key: string) => {
    if (!out[key]) out[key] = { unstd: null, stdyx: null };
    return out[key];
  };

  const apply = (rows: OutRow[], section: 'unstd' | 'stdyx') => {
    for (const r of rows) {
      if (!r.to) continue;
      const ids: string[] = [];
      if (r.block === 'BY') ids.push(`BY:${r.from}->${r.to}`);
      else if (r.block === 'ON') ids.push(`ON:${r.from}->${r.to}`);
      else if (r.block === 'WITH') {
        for (const kind of ['WITH', 'COVAR']) {
          ids.push(`${kind}:${r.from}->${r.to}`, `${kind}:${r.to}->${r.from}`);
        }
      }
      for (const id of ids) ensure(id)[section] = r.pValue;
    }
  };
  apply(parsed.unstd, 'unstd');
  apply(parsed.stdyx, 'stdyx');
  return out;
}
