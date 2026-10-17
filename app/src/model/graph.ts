import type { DgmFile, EstimateRow, ModelStmt, ModelTerm } from '../parser/dgm.js';

/**
 * In-memory model graph derived from a parsed DGM file.
 * Nodes correspond to latents or observed variables. Edges correspond to
 * directed relationships from MODEL `BY`/`ON` statements and undirected
 * `WITH` statements.
 *
 * Estimate rows from the DGM table that name two variables are matched to
 * edges by endpoints, preferring an edge of the row's own type (see
 * `matchEdgeForRow`; single-variable variance rows are skipped). A row with no matching edge synthesizes one: a code-2
 * (covariance) row becomes an undirected `COVAR` edge, and any other row
 * becomes an `ON` edge from the row's `from` to its `to`. Only codes 1
 * (unstandardized) and 11 (STDYX) attach an estimate and SE to the edge;
 * code 91 attaches a constraint label; every other code is matched but not
 * stored.
 */

export type NodeKind = 'latent' | 'observed';
export type EdgeKind = 'BY' | 'ON' | 'WITH' | 'COVAR';

export interface GraphNode {
  id: string;
  /** Display label (preserves the case from the MODEL block when possible). */
  label: string;
  kind: NodeKind;
}

export interface EdgeEstimate {
  value: number;
  se: number;
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
  /** Code-1 (unstandardized) estimate from the DGM table. */
  unstd: EdgeEstimate | null;
  /** Code-11 (STDYX) estimate from the DGM table. */
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
    const node: GraphNode = { id, label: rawName, kind };
    nodes.set(id, node);
    return node;
  };

  for (const v of dgm.useVar) ensureNode(v);
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
 * 21 (STDY) and 31 (STD). Code 91 also ends in 1 but is a constraint label
 * that can name any parameter, covariances included, so it is not treated
 * as directed.
 */
const DIRECTED_CODES: ReadonlySet<number> = new Set([1, 11, 21, 31]);

/** Estimate codes for covariances: last digit 2, in each estimate type. */
const COVARIANCE_CODES: ReadonlySet<number> = new Set([2, 12, 22, 32]);

const DIRECTED_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['BY', 'ON']);

/**
 * Find the existing edge an estimate row with `code` between `from` and
 * `to` describes, or `null` if none does.
 *
 * BY edges go latent->indicator and ON edges predictor->dependent, so the
 * table's `from`/`to` already match both. A row first looks for an edge of
 * its own type: a directed row (loading or regression) for a BY/ON edge with
 * exactly its endpoints, a covariance row for a WITH/COVAR edge in either
 * order. Only then does it fall back to any edge with exactly its endpoints
 * and, for a non-directed row, a symmetric edge in the reversed order. A
 * directed row never matches a reversed covariance: it has a direction of
 * its own and must not be absorbed by a covariance between the same pair.
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

  const directed = DIRECTED_CODES.has(code);
  const passes: ((e: GraphEdge) => boolean)[] = [];
  if (directed) {
    passes.push((e) => DIRECTED_KINDS.has(e.kind) && exact(e));
  } else if (COVARIANCE_CODES.has(code)) {
    passes.push((e) => isSymmetricKind(e.kind) && (exact(e) || reversedSymmetric(e)));
  }
  passes.push(exact);
  if (!directed) passes.push(reversedSymmetric);

  for (const pass of passes) {
    const hit = all.find(pass);
    if (hit) return hit;
  }
  return null;
}

function attachEstimates(
  rows: EstimateRow[],
  edges: Map<string, GraphEdge>,
  upsert: EdgeUpsert,
): void {
  for (const row of rows) {
    if (row.to == null) continue; // residual / variance row, not an edge
    // Estimate-only edges (e.g. covariance code 2 between observed vars that
    // wasn't declared `WITH` in the syntax) are synthesized: COVAR for code
    // 2, ON for anything else.
    const edge =
      matchEdgeForRow(row.code, row.from, row.to, edges.values()) ??
      upsert(row.code === 2 ? 'COVAR' : 'ON', row.from, row.to);

    if (row.code === 91) {
      if (row.constraintLabel) edge.constraint = row.constraintLabel;
      continue;
    }
    if (row.value == null || row.se == null) continue;

    if (row.code === 1) {
      edge.unstd = { value: row.value, se: row.se };
    } else if (row.code === 11) {
      edge.stdyx = { value: row.value, se: row.se };
    }
    // Other codes (2/4/5 and 1x/3x variants) describe variances or per-group
    // residuals; they are not directly attached to an edge in this round.
  }
}
