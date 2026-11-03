# `sem` Layout Engine Implementation Plan

> **For agentic workers:** execute with agent-config's `implement` skill (`/implement <this file>`), group by group. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `sem` layout engine, default for loaded models, that places variables as Mplus does, with straight paths, compact residuals and solid two-headed covariance curves; ELK stays available through a small picker.

**Architecture:** The parser keeps Mplus's level line. Pure functions in `layout/sem.ts` turn levels, or computed columns, into positions. Layout stores side choices, not coordinates, for residuals and curves, so `render/residual.ts` can recompute them when a node is dragged.

**Tech Stack:** TypeScript strict, Vitest (node), d3-selection, existing `LayoutEngine` registry. No new dependency.

**Contract (approved by Amelia, 2026-11-02):**
- A1. New `sem` engine, default for loaded models.
- A2. ELK stays available through a small picker.
- A3. Columns and stacking from Mplus's level line; computed columns as fallback.
- A4. Indicator sides follow D7 in `docs/diagram-conventions.md`.
- A5. Residuals in the first version: compact arrow by default, built so other styles can be added.
- A6. Covariances: solid curves with two arrowheads. A covariance between dependent variables joins residuals (D5).
- A7. Sources logged for decisions (`docs/diagram-conventions.md`, done before this plan's tasks).
- Non-goals: parity mode, means, label collision work, SE or CI labels, export, multi-group display, Mplus 9 checks.

**Parallel groups:** run in order, one at a time: Task 1, 2, 3, 4, 5, 6, 7. Project priority is sequential, reviewed work (`AGENTS.md`).

**Spec:** `docs/diagram-conventions.md`.

## Global Constraints

- `base: './'` stays; no host or endpoint. `.js` suffixes on imports. No em dashes.
- `strict`, `noUnusedLocals`, `noUnusedParameters`. Tests read `dgm/` by corpus loop; tests that read `docs/reference/` skip when absent.
- Unknown `.dgm` shapes never throw because of this work: a missing or malformed level line gives `levels: null`.
- Positions remain authoritative after load. Nothing in residuals or curves may store absolute coordinates.
- No copyrighted figure or text in the repository.
- Each commit ends `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commits local; push after clean `/code-review`; opening a PR waits for Amelia.

## Review Focus

1. A file with no level line (fallback): must still lay out, no overlap. Task 3 test.
2. A nonrecursive model (reciprocal ON): computed columns must terminate. Task 3 test.
3. An indicator of two factors (cross-loading): appears once, beside its first factor. Task 3 test.
4. Dragging a node: residual and curve follow it. Task 4 test on the pure geometry.
5. An `elk-layered` result has no residuals or curves: renders as today apart from solid two-headed covariances. Task 5 manual check.

---

### Task 1: Keep the level line; stop treating 999 as an estimate

**Files:**
- Modify: `app/src/parser/dgm.ts` (`DgmHeader`, `parseEstimateSection`, `readGroupingsCount`)
- Modify: `app/src/model/graph.ts` (`attachEstimates`, `GraphNode`)
- Test: `app/src/parser/dgm.test.ts`, `app/src/model/graph.test.ts`

**Interfaces:**
- Produces: `DgmHeader.levels: number[] | null`, aligned with `allVariables`; `GroupingsCount.levels`. `GraphNode.level: number | null`, `GraphNode.residual: { unstd: EdgeEstimate | null; stdyx: EdgeEstimate | null } | null`.

- [ ] **Step 1: Failing tests.** `syn_sem.dgm`: `levels` gives -1 for `a1`, 0 for `z1`, 1 `fa`, 2 `fb`, 3 `fc`, 4 `x1`. Corpus loop: `levels.length === allVariables.length`. Header without the line: `levels` null. Graph: `syn_path` node `m1` has `level` 1 and `residual.unstd.value` 0.593 (code 4 row); `syn_path` edge k1-k2 has `unstd` null, regression title naming the 999.000 bug.
- [ ] **Step 2:** Run `npx vitest run src/parser/dgm.test.ts src/model/graph.test.ts`. Expected: FAIL.
- [ ] **Step 3:** In `readGroupingsCount` return the parsed codes. `scanForGroupingsCount` gives `levels: null`. In `attachEstimates` skip attaching when `est === 999`. Codes 4 and 14 set `residual`; codes 5 and 15 on a latent set it too (Mplus prints both in the same place).
- [ ] **Step 4:** Tests pass; `npm test` passes. Update any assertion that pinned a 999 estimate.
- [ ] **Step 5:** Commit: "Keep Mplus's level line; drop 999 placeholders".

### Task 2: Layout types and pure column logic

**Files:**
- Modify: `app/src/layout/index.ts`
- Create: `app/src/layout/semColumns.ts`, `app/src/layout/semColumns.test.ts`

**Interfaces:**
- Consumes: `GraphNode.level`.
- Produces:
  - `type Side = 'left' | 'right' | 'top' | 'bottom'`
  - `ResidualLayout { id: string; side: Side }`; `LayoutResult.residuals?: ResidualLayout[]`
  - `EdgeLayout.curve?: { side: Side; attach: 'node' | 'residual' }`
  - `semColumns(graph): { columns: string[][]; indicators: Map<string, string[]> }` (structural ids per column in graph order; indicators per latent, each indicator under its first factor)
  - `indicatorSide(column: number, columnCount: number, indexInColumn: number, latentsInColumn: number): Side`

- [ ] **Step 1: Failing tests.** `indicatorSide(0,1,0,2)` right; `(0,3,0,1)` left; `(2,3,0,1)` right; `(1,3,0,1)` bottom; `(1,4,0,2)` top; `(1,4,1,2)` bottom. `semColumns` on `syn_sem`: `[[z1],[fa],[fb],[fc],[x1,x2]]`. On `ms_fig2`: column 0 `[eth_1, civ_1]`. Levels removed from `syn_sem` (copy graph, `level: null`): same column for `fa` before `fb` before `fc`, and terminates on a graph with reciprocal ON edges. Cross-loading indicator appears under one latent only.
- [ ] **Step 2:** Run `npx vitest run src/layout/semColumns.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Indicator: level -1, or, with no levels, a node with an incoming BY. Fallback column: longest ON path from nodes with no structural parent, with a visiting set so a cycle stops the walk.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: "Add SEM column assignment and indicator sides".

### Task 3: Engine placement

**Files:**
- Create: `app/src/layout/sem.ts`, `app/src/layout/sem.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces: `semEngine: LayoutEngine` with `name: 'sem'`. Top-left node coordinates as ELK gives them.

Placement: each latent and its fan form a block. Bottom or top fan: indicators in a row, block as wide as the row. Left or right fan: indicators in a column beside the latent, centred on it. Column width is its widest block; block stacked with `BLOCK_GAP`. Columns are centred vertically and separated by `COLUMN_GAP`; choose both so a value label fits between (start at 80 and 60, tune by eye). `residuals` has one entry per node with `residual`, side away from where its paths arrive: fan left, `left`; right, `right`; bottom, `bottom`; top, `top`; a structural node, `right` in the last column, else `top`. A symmetric edge gets `curve`: `attach: 'residual'` when both ends receive a directed path, else `'node'`; side is the free outer side: `left` for column 0 pairs without a left fan, `right` when a left fan takes it (`ex5.11`), `right` for last-column pairs, `bottom` for two fans in a row. `bend` is empty for all edges.

- [ ] **Step 1: Failing tests.** Corpus loop: no two node boxes overlap, all finite, every graph node placed. Corpus loop: where levels exist, structural centres have strictly increasing x by level, and stack in list order within a level. `syn_sem`: `a1` to `a3` lie below `fa`; `pcwas_cfa`: indicators right of factors; `ms_fig2`: `et_anc1` left of `eth_1`. `syn_sem`: no directed path crosses an unrelated box. `syn_path`: edge d1-d2 has `curve.attach` `'residual'`; k1-k2 `'node'`, side `left`. A graph with `level: null` everywhere has no overlaps.
- [ ] **Step 2:** Run `npx vitest run src/layout/sem.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `semEngine`.
- [ ] **Step 4:** Tests pass. Print paths-behind-boxes counts per fixture and record them in the plan's Baseline, beside ELK straight (1 to 19 per file, earlier audit). Some are expected: Mplus has them too, as column-mates (`idnfc41b`). Stop and report if `sem` is worse than ELK on any fixture.
- [ ] **Step 5:** Commit: "Add sem layout engine".

### Task 4: Residual and curve geometry

**Files:**
- Create: `app/src/render/residual.ts`, `app/src/render/residual.test.ts`
- Modify: `app/src/ui/viewBox.ts` comment if the hull claim changes

**Interfaces:**
- Consumes: `Side`, `Box`, `boundaryPoint`.
- Produces:
  - `type ResidualStyle = 'compact-arrow'` (one case now; a new style adds a union member and a case)
  - `residualGeometry(style: ResidualStyle, box: Box, shape: NodeShape, side: Side): { tail: Point; tip: Point; labelAnchor: Point }`
  - `curveGeometry(a: Point, b: Point, side: Side): { d: string; control: Point; mid: Point }`
  - `RESIDUAL_LENGTH`

- [ ] **Step 1: Failing tests.** `side: 'right'` on a rect: tail right of box by `RESIDUAL_LENGTH`, tip on the right edge, same y. On an ellipse the `top` residual tip is on the outline and diagonal, tail up and left. Moving the box moves all three by the same amount. `curveGeometry` with `side: 'left'`: `control.x` left of both ends; two stacked points three rows apart bulge further than one row apart, so a long curve clears the column.
- [ ] **Step 2:** Run `npx vitest run src/render/residual.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Quadratic Bezier; bulge grows with endpoint distance.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit: "Add residual and covariance curve geometry".

### Task 5: Render residuals and covariances

**Files:**
- Modify: `app/src/render/svg.ts`, `app/src/render/styles.ts`, `app/src/main.ts` (`fitViewBox`), `app/src/state/store.ts` only if `loadGraph` drops `residuals`
- Test: `app/src/render/styles.test.ts` if style defaults change

**Interfaces:**
- Consumes: Tasks 2, 4.
- Produces: `residualsG` layer; `global.residualStyle: ResidualStyle`, default `'compact-arrow'`.

- [ ] **Step 1:** Remove the forced dash at `svg.ts:292-294`. Put two arrowheads on symmetric edges (`marker-start` with `orient="auto-start-reverse"`). A test on the effective style if logic moves into `styles.ts`; closes TODO "WITH / COVAR style shown wrongly in the inspector" if the inspector now tells the truth.
- [ ] **Step 2:** Draw curves from `EdgeLayout.curve`, with ends at residual tails when `attach` is `'residual'`, from `residualGeometry` on merged positions. Edge without `curve` keeps `computePath`. Straight BY and ON edges: `computePath` draws `C` with collinear controls; keep.
- [ ] **Step 3:** Draw residual arrows and values (`coefMode` picks unstd or stdyx, `global.decimals`), under `showCoefficients`.
- [ ] **Step 4:** Add residual tails and curve control points to `points` in `fitViewBox`, so nothing is clipped.
- [ ] **Step 5:** `npm test` and `npm run build` pass.
- [ ] **Step 6:** Commit: "Draw residuals and two-headed covariances".

### Task 6: Default and picker

**Files:**
- Modify: `app/src/ui/toolbar.ts`, `app/src/main.ts:36,73-83,182-190`
- Create: `app/src/layout/index.test.ts` if none covers the default

**Interfaces:**
- Consumes: `semEngine`, `listLayoutEngines()`.
- Produces: `DEFAULT_LAYOUT_ENGINE = 'sem'` in `layout/index.ts`; `ToolbarHooks.onEngineChange(name: string)`.

- [ ] **Step 1:** Register both engines. `runLayout` reads a module-level `engineName`, starting at the default, and throws as today when unknown.
- [ ] **Step 2:** `<select>` in the Layout toolbar group, labels `SEM` and `ELK`; change sets `engineName` and re-runs layout. It therefore behaves as Re-run layout does, wiping styles and undo. That open TODO is not fixed here; say so in the PR.
- [ ] **Step 3:** `npm test`, `npm run build`.
- [ ] **Step 4:** Commit: "Make sem the default layout; add engine picker".

### Task 7: Verify in the app; update docs

**Files:** `AGENTS.md`, `TODO.md`, `docs/diagram-conventions.md`, this plan

- [ ] **Step 1:** Start the dev server. Load `syn_path`, `syn_sem`, `pcwas_cfa`, `dc_tol_cfaallcorrelations`, `ms_fig2`, `idnfc41b`; drag a node with a residual and a curve; switch to ELK and back; confirm no console errors. Screenshot each and compare with Amelia's Mplus screenshots.
- [ ] **Step 2:** `AGENTS.md`: layout section (`sem` default, level line), render section (residuals, two-headed curves), parser section (`levels`). Close or update TODO items on straight paths, covariances in the layout and the 999 note.
- [ ] **Step 3:** Update decision entries for anything the build changed.
- [ ] **Step 4:** Commit: "Document the sem layout".
- [ ] **Step 5:** `/code-review` on `main...HEAD`; fix or answer each finding; `npm test`; `npm run build`; push `feat/sem-layout`.

## Baseline

- Before Task 1 (after merging `main`, a6074ce): 282 tests pass, build clean.
- Paths behind boxes: to fill in at Task 3 Step 4.

## Rulings

- Task 1: the planned 999 edge test passed before any change, because no covariance value is stored (only codes 1 and 11 attach). Replaced by a test that a 999 residual row gives no estimate. TODO entry rewritten. Residual rows are not filtered by group, like edge rows; multi-group stays an open decision.
