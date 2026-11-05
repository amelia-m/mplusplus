# Diagram conventions: decisions and sources

Why the app draws what it draws, and what each choice rests on. Amelia, 2026-11-02: "make sure we're logging sources used in decisions etc". Every drawing or layout decision gets an entry here when it is made.

**What counts as a source.** A source is cited only if its own text or figure was seen (PDF text extracted, page read in a browser, a screenshot of the figure). Search results and fetch-tool summaries do not count (Amelia, 2026-11-01: "Don't rely on unverified summaries"). Each citation says how it was seen. Unread sources stay under "Not read". Sources are paraphrased; the books are copyrighted and stay in the gitignored `docs/reference/`.

**Evidence levels.** *Stated*: a source says it. *Shown*: seen in figures, with no rule stated. *Observed*: read from Mplus's files or output. *Inferred*: our conclusion, not said anywhere. *Choice*: decided here, with no source either way.

## Decisions

| # | Decision | Level | Basis | Decided |
|---|---|---|---|---|
| D1 | Rectangles for observed variables, ellipses for latents | Stated | Kline pp. 121-122 calls this universal; Raykov p. 11, Fig 5; tidySEM; `sem`; Steiger | Existing; confirmed 2026-11-02 |
| D2 | Directed paths are straight lines | Stated, Observed | Kline p. 121; Raykov p. 12 (usual form, curved allowed when space is short); all 11 Mplus diagrams seen. Amelia, 2026-11-01: bent paths do not follow SEM conventions | 2026-11-01 |
| D3 | Covariances are solid curves with two arrowheads | Stated, Observed | Kline p. 121 and pp. 191, 193 (dashed marks a covariance not required to be estimated); Raykov p. 12; Mplus. tidySEM draws none and Steiger allows either, so not universal despite Kline's word. Replaces the dashed, arrow-less default. Amelia, 2026-11-01: "y" | 2026-11-02 |
| D4 | Residuals shown by default as a short arrow into the variable, unlabelled symbol with its value at the tail. Built so other styles can be added | Stated, Observed | Kline pp. 130-131 Fig 6.2(c), called acceptable; Raykov Fig 5; Mplus. McDonald and Ho pp. 75-76: three conventions, no agreement, so more styles should follow. Amelia, 2026-11-01: "y" | 2026-11-02 |
| D5 | A covariance between two dependent variables joins their residuals (arrow tails), not their boxes | Stated, Observed, Inferred | Kline p. 122 and Raykov p. 13: no two-way arrow directly joins dependent variables; Raykov p. 18: residual correlations join error terms; Mplus draws them between tails. Telling which edges qualify from the model is our inference | 2026-11-02 |
| D6 | The `sem` engine takes columns and stacking order from Mplus's level line in the `.dgm`, and computes columns when the line is absent | Observed, Inferred | `.dgm` header: one integer per variable, -1 exactly for indicators in 49 of 49 files, and level = column left to right on 11 diagrams by eye. Undocumented by Mplus; meaning inferred. Mplus 8.11 only. Amelia, 2026-11-02: "y" | 2026-11-02 |
| D7 | Indicators sit on a free outer side: one column only, right; first of several columns, left; last column, right; middle column, below, or above for the first latent of a column holding several | Observed, Shown | Mplus, 11 diagrams, no exception; our reading, not documented. Kline Fig 10.1, 15.3; Raykov Fig 3; Hoyle Fig 1.1 show the same idea | 2026-11-02 |
| D8 | Covariance curves bulge to a free side, and past stacked nodes | Observed, Shown | Mplus `ex5.1`, `ex5.11`; Kline Fig 6.2, 7.1. A curve inside a column cut through nodes when tried on 2026-10-16 (`TODO.md`) | 2026-11-02 |
| D9 | `sem` is the default engine; ELK stays available through a small picker. Superseded by D14 | Choice | Amelia, 2026-11-02: "y" | 2026-11-02 |
| D14 | `sem` is the only engine: ELK and its picker are dropped (elkjs 0.9.3 was EPL-2.0 only, no fixture needed it, and it was most of the bundle). A saved diagram laid out by ELK is laid out again on restore | Choice | Amelia, 2026-11-03: "drop" | 2026-11-03 |
| D15 | Rotate and flip: 90° steps and flips (left-right, top-bottom), on the selection or the whole diagram, applied to the stored positions; box sizes and text stay upright, the spacing that turns from vertical to horizontal is stretched by the widest box's width over the shortest box's height (and shrunk the other way) so boxes within the turned group do not overlap (a whole-diagram turn adds none on any fixture; turning one block can still run it into boxes outside it, 4 of 70 single-block turns on the fixtures, open in `TODO.md`); residual and covariance curve sides turn with the boxes. A latent's top or bottom residual is still drawn on the diagonal from the left (D12), so after a flip it does not mirror: known, not yet decided | Choice | Amelia, 2026-11-03: "90° steps + flips", "Stored positions" | 2026-11-03 |
| D16 | Residual side per variable: top, right, bottom, left or the layout's default, set for every selected variable; a covariance curve drawn between residual tails follows when both its residuals share a side, and goes back to the layout's side when both are back on the default | Choice | Amelia, 2026-11-03: "4 sides + auto now" | 2026-11-03 |
| D17 | A measurement block is picked either by selecting its boxes or by selecting the factor and pressing Select block, which adds everything it measures through BY (indicators; for a second-order factor its first-order factors and theirs; a cross-loading indicator comes along) | Choice | Amelia, 2026-11-03: "Both" | 2026-11-03 |
| D10 | Nothing is drawn for a parameter Mplus does not estimate: a `999.000` row carries no value | Observed | `syn_path`: Mplus draws k1-k3 curves with no value | 2026-11-02 |
| D12 | Residual sides: an indicator's points away from its factor; otherwise observed variables take the right and latents the upper left (lower left when their own indicators are above). The rule for observed variables is superseded by D18; latents keep it | Observed | Mplus `syn_path`, `ex3.11`, `syn_sem`, `ex5.11` | 2026-11-02, while building |
| D18 | Residuals default to the diagram's outer edge. An observed variable's residual points left in the left half of the columns, right in the right half, and in the middle column (odd column count, a one-column diagram included) to `MIDDLE_COLUMN_RESIDUAL_SIDE`, left for now, pending Amelia's confirmation. Halves and the middle are counted in the `sem` engine's columns (D6), not in drawn width; an even count has no middle column. An indicator's residual points away from its factor, which is the outer edge too since fans sit on a free outer side (D7): up for a fan above a factor at the top, down for a fan below one at the bottom. A latent's own residual keeps D12 for now. A side the user sets (D16) still wins, and a covariance curve between residual tails follows its residuals' sides. Departs from Mplus, which points dependent observed variables right (D12) | Choice | Amelia, 2026-11-04: "residuals should default to outer edges (eg left on the left hand side and right on the right side)"; "yes but also if a factor is at the top with indicators above, residuals should be above the indicators. reverse if factor is at bottom of diagram"; on factors' own residuals, "for now, I think no but we should revisit later"; on the middle column, "I'm thinking default left" (proposal, not yet confirmed) | 2026-11-04 |
| D13 | A column standing in the way of a path that skips it moves down until the path clears it | Observed | Mplus lowers `fb` in `syn_sem`, `m1` in `syn_path` and `ex3.11`'s middle column looks the same; the rule is our reading | 2026-11-02, while building |
| D11 | Weighted analyses carry a caption. Mplus does not show this; it extends Mplus | Choice | Amelia, 2026-11-01. Mplus checked by her screenshot of `lcsmcn` | 2026-11-01 |

## Open, with evidence so far

- **Means:** not drawn yet. Kline p. 372: no standard symbol, and a diagram may leave them out. Triangle in Kline Fig 15.1, 15.3 and semPlot.
- **Exogenous variances:** Mplus prints latents' beside the circle, none for observed. Full RAM loops (Kline Fig 6.2) would be another residual style.
- **Adjacent factors:** Raykov Fig 6 joins them with straight two-headed arrows; could help crowded diagrams.
- **Hiding indicators:** McDonald and Ho make a case for a table of the measurement model instead.
- **Box size:** in `ex5.6` and `dc_tol_cfaallcorrelations` indicator boxes are smaller than other shapes in the same diagram; rule unknown. Needed for parity mode.
- **Mplus 9:** nothing here is checked against it.

## Sources

| Source | How seen | Used for |
|---|---|---|
| Kline, *Principles and Practice of Structural Equation Modeling*, 4th ed., 2016 | Local PDF, text via `pypdf`: pp. 3, 121-122, 130-132, 191, 193-194, 214-215, 372, 445, 456. Figures 6.2, 7.1, 10.1, 13.6, 15.1, 15.3 by screenshot | D1-D5, D7, D8 |
| Raykov and Marcoulides, *A First Course in Structural Equation Modeling*, 2nd ed., 2006 | Local PDF, text pp. 8-20. Figures 2, 3, 5, 6 by screenshot | D1-D5, D7 |
| Hoyle (ed.), *Handbook of Structural Equation Modeling*, ch. 1 | Local extract, p. 5. Figure 1.1 by screenshot | D7 |
| McDonald and Ho 2002, *Psychological Methods* 7(1), 64-82 | PDF text, pp. 75-76, 78; figures not seen. https://www3.nd.edu/~kyuan/courses/sem/readpapers/McDOnald-Ho-PM02-reporting.pdf | D4 |
| APA JARS-Quant Table 7 | Official PDF text. https://apastyle.apa.org/jars/quant-table-7.pdf | No drawing rules; context |
| Boomsma 2000, *Structural Equation Modeling* 7, 461-483 | PDF text, passage on path diagrams. https://aboomsma.webhosting.rug.nl/boomsma00.pdf | Context |
| Mplus Diagrammer guide, 2012 | Local PDF, in part | What Mplus prints |
| Mplus 8.11 Diagrammer output | Amelia's screenshots, 2026-11-01 and 2026-11-02: `lcsmcn`, `syn_path`, `syn_sem`, `pcwas_cfa`, `dc_tol_cfaallcorrelations`, `ms_fig2`, `idnfc41b`, `ex3.11`, `ex5.1`, `ex5.8`, `ex5.11`, `ex5.6`. Not kept | D2-D8, D10 |
| `.dgm` files | Read directly; a throwaway script checked all 49 local files on 2026-11-02 | D6, D10 |
| Steiger, path diagram handout | PDF text, opening and start of the rules. https://statpower.net/Content/GCM/Handouts/Path%20Diagrams.pdf | D1, D3 |
| tidySEM vignette | Page read in full. https://cran.r-project.org/web/packages/tidySEM/vignettes/sem_graph.html | D1, D3 |
| R `sem`, `pathDiagram` | Page read in part. https://search.r-project.org/CRAN/refmans/sem/html/pathDiagram.html | D1 |
| semPlot, `semPaths` | Page read in part. https://search.r-project.org/CRAN/refmans/semPlot/html/semPaths.html | Means; levels considered and set aside for D7 |
| SAS PROC CALIS | Page read in part. https://support.sas.com/documentation/cdl/en/statug/68162/HTML/default/statug_calis_details135.htm | Layout ideas considered |

## Not read

- Ho, Stark and Chernyshenko, Handbook of SEM ch. 3, "Graphical Representation of Structural Equation Models Using Path Diagrams", pp. 43-55. The most relevant unread source. Amelia is trying to get it; the build went ahead without it (2026-11-02).
- McArdle and McDonald 1984; McArdle 1980; Boker, McArdle and Neale 2002.
- Literature on growth-model diagrams beyond Kline Fig 15.3.
