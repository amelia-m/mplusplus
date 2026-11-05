import type { DgmFile, EstimateRow, ModelStmt, ModelTerm } from '../parser/dgm.js';

/**
 * In-memory model graph derived from a parsed DGM file.
 * Nodes correspond to latents or observed variables. Edges correspond to
 * directed relationships from MODEL `BY`/`ON` statements and undirected
 * `WITH` statements.
 *
 * Estimate rows from the DGM table that name two variables are matched to
 * edges by endpoints, preferring an edge of the row's own type (see
 * `matchEdgeForRow`; single-variable variance rows are skipped). A row with
 * no matching edge synthesizes one: a covariance row (code 2, 12, 22, 32
 * or 92) becomes an undirected `COVAR` edge, and any other row becomes an
 * `ON` edge from the row's `from` to its `to`. Codes 1 and 2
 * (unstandardized loading or regression, and covariance) and 11 and 12
 * (their STDYX forms) attach an estimate, SE and confidence limits to the
 * edge, except a `999.000` estimate, which Mplus writes for a parameter it
 * does not estimate; label rows (91, 92) attach a constraint label; every
 * other code is matched but not stored.
 */

export type NodeKind = 'latent' | 'observed';
export type EdgeKind = 'BY' | 'ON' | 'WITH' | 'COVAR';

export interface EdgeEstimate {
  value: number;
  /** Standard error; `NaN` when Mplus printed `999.000` for it (no SE). */
  se: number;
  /**
   * 95% confidence limits, from a file run with `OUTPUT: CINTERVAL`; absent
   * or null otherwise. Set on edge estimates only, not residuals.
   */
  ci?: { lower: number; upper: number } | null;
}

export interface GraphNode {
  id: string;
  /** Display label (preserves the case from the MODEL block when possible). */
  label: string;
  kind: NodeKind;
  /** Mplus's level for the variable (`DgmHeader.levels`), or null when unknown. */
  level: number | null;
  /**
   * Residual variance of a dependent variable, or the variance of an
   * independent one: codes 4 and 14, 5 and 15. Mplus draws both at the same
   * place. Null when the table has neither.
   */
  residual: { unstd: EdgeEstimate | null; stdyx: EdgeEstimate | null } | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** True if this edge was free-estimated in syntax (`*` modifier). */
  free: boolean;
  /** Numeric pin from `@val`, e.g. `@1`. */
  fixed: number | null;
  /** Equality-constraint label from syntax `(label)` or estimate code 91. */
  constraint: string | null;
  /** Unstandardized estimate from the DGM table: code 1, or code 2 for a covariance. */
  unstd: EdgeEstimate | null;
  /** STDYX estimate from the DGM table: code 11, or code 12 for a covariance (a correlation). */
  stdyx: EdgeEstimate | null;
}

export interface ModelGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Original parsed file, retained for round-trip / refresh flows. */
  source: DgmFile;
}

const lower = (s: string): string => s.toLowerCase();

/**
 * Undirected edge kinds: `a WITH b` and `b WITH a` are the same parameter,
 * so the graph holds one edge per unordered pair. The edge keeps the
 * orientation (and therefore the id) of its first declaration.
 */
const SYMMETRIC_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['WITH', 'COVAR']);

export const isSymmetricKind = (kind: EdgeKind): boolean => SYMMETRIC_KINDS.has(kind);

export function buildGraph(dgm: DgmFile): ModelGraph {
  const latentSet = new Set(dgm.latents.map(lower));
  const observedSet = new Set(dgm.observed.map(lower));

  // Some files don't list every USEVAR variable in the post-INPUT_END
  // groupings header (e.g. predictors that are neither indicators nor
  // latents). Make sure those still appear as nodes if they show up in
  // model statements or the estimate table.
  const levelOf = new Map<string, number>();
  dgm.header.levels?.forEach((level, k) => levelOf.set(lower(dgm.header.allVariables[k]), level));

  const nodes = new Map<string, GraphNode>();
  const ensureNode = (rawName: string, hint?: NodeKind): GraphNode => {
    const id = lower(rawName);
    const existing = nodes.get(id);
    if (existing) return existing;
    const kind: NodeKind = latentSet.has(id)
      ? 'latent'
      : observedSet.has(id)
        ? 'observed'
        : (hint ?? 'observed');
    const node: GraphNode = { id, label: rawName, kind, level: levelOf.get(id) ?? null, residual: null };
    nodes.set(id, node);
    return node;
  };

  // USEVARIABLES can name variables outside the model: a WEIGHT variable is
  // listed there, but Mplus leaves it out of its own variable list and draws
  // no box for it (`lcsmcn.dgm`, seen in Mplus's Diagrammer 2026-11-01).
  const modelled = new Set(dgm.header.allVariables.map(lower));
  for (const v of dgm.useVar) {
    if (modelled.has(lower(v))) ensureNode(v);
  }
  for (const lat of dgm.latents) ensureNode(lat, 'latent');
  for (const obs of dgm.observed) ensureNode(obs, 'observed');

  const edges = new Map<string, GraphEdge>();
  const edgeId = (kind: EdgeKind, from: string, to: string): string =>
    `${kind}:${lower(from)}->${lower(to)}`;
  const upsertEdge = (
    kind: EdgeKind,
    from: string,
    to: string,
    term?: ModelTerm,
  ): GraphEdge => {
    const id = edgeId(kind, from, to);
    const existing =
      edges.get(id) ?? (isSymmetricKind(kind) ? edges.get(edgeId(kind, to, from)) : undefined);
    if (existing) {
      if (term) {
        if (term.free) existing.free = true;
        if (term.fixed != null) existing.fixed = term.fixed;
        if (term.constraint) existing.constraint = term.constraint;
      }
      return existing;
    }
    ensureNode(from, kind === 'BY' ? 'latent' : undefined);
    ensureNode(to, kind === 'BY' ? 'observed' : undefined);
    const edge: GraphEdge = {
      id,
      from: lower(from),
      to: lower(to),
      kind,
      free: term?.free ?? false,
      fixed: term?.fixed ?? null,
      constraint: term?.constraint ?? null,
      unstd: null,
      stdyx: null,
    };
    edges.set(id, edge);
    return edge;
  };

  for (const stmt of dgm.modelStatements) {
    walkStatement(stmt, upsertEdge);
  }

  // Attach numeric estimates from the post-INPUT_END table.
  attachEstimates(dgm.estimates, edges, upsertEdge);
  attachResiduals(dgm.estimates, nodes);

  return { nodes: Array.from(nodes.values()), edges: Array.from(edges.values()), source: dgm };
}

type EdgeUpsert = (
  kind: EdgeKind,
  from: string,
  to: string,
  term?: ModelTerm,
) => GraphEdge;

function walkStatement(stmt: ModelStmt, upsert: EdgeUpsert): void {
  // BY: latent measures observed indicators (latent -> indicator).
  // ON:  dependent regressed on predictors (predictor -> dependent).
  // WITH: residual covariance (undirected; emitted as a single edge).
  // Self-pin "WITH" statements (lhs === rhs.name) describe a variance and
  // produce no edge.
  switch (stmt.op) {
    case 'BY':
      for (const t of stmt.rhs) {
        if (!t.name) continue;
        upsert('BY', stmt.lhs, t.name, t);
      }
      return;
    case 'ON':
      for (const t of stmt.rhs) {
        if (!t.name) continue;
        upsert('ON', t.name, stmt.lhs, t);
      }
      return;
    case 'WITH':
      for (const t of stmt.rhs) {
        if (!t.name) continue;
        if (lower(t.name) === lower(stmt.lhs)) continue;
        upsert('WITH', stmt.lhs, t.name, t);
      }
      return;
  }
}

/**
 * Estimate codes for directed parameters (loadings and regressions): the
 * codes whose last digit is 1, i.e. 1 (unstandardized), 11 (STDYX),
 * 21 (STDY) and 31 (STD), and 91, the constraint label of a loading or
 * regression.
 */
const DIRECTED_CODES: ReadonlySet<number> = new Set([1, 11, 21, 31, 91]);

/**
 * Codes for covariances: last digit 2, in each estimate type, and 92, the
 * constraint label of a covariance.
 */
const COVARIANCE_CODES: ReadonlySet<number> = new Set([2, 12, 22, 32, 92]);

const DIRECTED_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['BY', 'ON']);

/**
 * Find the existing edge an estimate row with `code` between `from` and
 * `to` describes, or `null` if none does.
 *
 * BY edges go latent->indicator and ON edges predictor->dependent, so the
 * table's `from`/`to` already match both. A row with a parameter type
 * matches only edges of that type: a directed row (loading or regression)
 * only a BY/ON edge with exactly its endpoints, a covariance row only a
 * WITH/COVAR edge, in either order (a symmetric edge keeps the orientation
 * of its first declaration, which says nothing about the row). Otherwise a
 * regression would be absorbed by a covariance between the same pair, or
 * the reverse, depending only on how the syntax was written. A row of a
 * code not known here takes any edge with exactly its endpoints, then a
 * symmetric edge in the reversed order.
 */
export function matchEdgeForRow(
  code: number,
  from: string,
  to: string,
  edges: Iterable<GraphEdge>,
): GraphEdge | null {
  const f = lower(from);
  const t = lower(to);
  const all = Array.from(edges);
  const exact = (e: GraphEdge): boolean => e.from === f && e.to === t;
  const reversedSymmetric = (e: GraphEdge): boolean =>
    isSymmetricKind(e.kind) && e.from === t && e.to === f;

  if (DIRECTED_CODES.has(code)) {
    return all.find((e) => DIRECTED_KINDS.has(e.kind) && exact(e)) ?? null;
  }
  if (COVARIANCE_CODES.has(code)) {
    return all.find((e) => isSymmetricKind(e.kind) && (exact(e) || reversedSymmetric(e))) ?? null;
  }
  return all.find(exact) ?? all.find(reversedSymmetric) ?? null;
}

function attachEstimates(
  rows: EstimateRow[],
  edges: Map<string, GraphEdge>,
  upsert: EdgeUpsert,
): void {
  for (const row of rows) {
    if (row.to == null) continue; // residual / variance row, not an edge
    // Estimate-only edges (e.g. a covariance between observed vars that
    // wasn't declared `WITH` in the syntax) are synthesized: COVAR for a
    // covariance code, ON for anything else.
    const edge =
      matchEdgeForRow(row.code, row.from, row.to, edges.values()) ??
      upsert(COVARIANCE_CODES.has(row.code) ? 'COVAR' : 'ON', row.from, row.to);

    // A label row (91, 92) carries a label and no estimate.
    if (row.constraintLabel !== null) {
      edge.constraint = row.constraintLabel;
      continue;
    }
    const estimate = edgeEstimateOf(row);
    if (estimate === null) continue;

    // The matcher keeps 1/11 on BY/ON edges and 2/12 on WITH/COVAR edges.
    if (row.code === 1 || row.code === 2) {
      edge.unstd = estimate;
    } else if (row.code === 11 || row.code === 12) {
      edge.stdyx = estimate;
    }
    // STDY (2x) and STD (3x) rows are matched but not stored.
  }
}

/**
 * The estimate a row carries, or null when it has none: a label row, or a
 * `999.000` estimate (not estimated by Mplus). A `999.000` SE becomes NaN
 * (no SE), and `999.000` limits are dropped.
 */
function edgeEstimateOf(row: EstimateRow): EdgeEstimate | null {
  if (row.value == null || row.se == null || row.value === NOT_ESTIMATED) return null;
  const se = row.se === NOT_ESTIMATED ? Number.NaN : row.se;
  const ci =
    row.ci && row.ci.lower !== NOT_ESTIMATED && row.ci.upper !== NOT_ESTIMATED
      ? { lower: row.ci.lower, upper: row.ci.upper }
      : null;
  return { value: row.value, se, ci };
}

/** True when any edge has confidence limits in either coefficient mode. */
export function hasConfidenceLimits(graph: Pick<ModelGraph, 'edges'> | null): boolean {
  return graph?.edges.some((e) => Boolean(e.unstd?.ci || e.stdyx?.ci)) ?? false;
}

/** Unstandardized and STDYX codes of residual variances (4) and variances (5). */
const RESIDUAL_UNSTD: ReadonlySet<number> = new Set([4, 5]);
const RESIDUAL_STDYX: ReadonlySet<number> = new Set([14, 15]);

/** Mplus writes 999.000 for a parameter it does not estimate. */
const NOT_ESTIMATED = 999;

function attachResiduals(rows: EstimateRow[], nodes: Map<string, GraphNode>): void {
  for (const row of rows) {
    if (row.to != null || row.value == null || row.se == null) continue;
    if (row.value === NOT_ESTIMATED) continue;
    const unstd = RESIDUAL_UNSTD.has(row.code);
    if (!unstd && !RESIDUAL_STDYX.has(row.code)) continue;
    const node = nodes.get(lower(row.from));
    if (!node) continue;
    node.residual ??= { unstd: null, stdyx: null };
    node.residual[unstd ? 'unstd' : 'stdyx'] = { value: row.value, se: row.se };
  }
}
