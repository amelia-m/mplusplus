# Reference documents

Third-party documentation used while building mplusplus. The PDFs are
copyrighted by their publishers, so they are kept here locally and are not
committed (everything in `docs/reference/` except this index is in
`.gitignore`). Each entry gives its source so a copy can be made again.

Anyone working on this repo is expected to have Mplus installed, and with it
the Mplus documentation and the User's Guide examples. Docs, tests and notes
may therefore refer to these files by name (for example `ex5.20.out`); the
files themselves are never committed or bundled into the app. Tests that use
them must skip, not fail, when the local copy is absent.

| Local file | Document | Official source | Saved |
|---|---|---|---|
| `mplus-diagrammer-v1-2012.pdf` | Mplus Diagrammer, Version 1, September 2012 (3 pages, B. Muthen). What the Diagrammer draws (rectangles for observed, circles for latent variables, paths, covariances, residuals) and its View options (standardized values, parameter labels, decimals, show only significant). | https://www.statmodel.com/download/Mplus%20Diagrammer.pdf | 2026-10-16 |
| `mplus-users-guide-v8.pdf` (6.1 MB, about 950 pages) | Mplus User's Guide, Version 8, the full manual: syntax, the example chapters with their model figures (chapter 5 for CFA/SEM), and chapter 18 on OUTPUT, including the STANDARDIZED results layout. | Copied read-only from the local Mplus installation: `C:\Program Files\Mplus\Documentation\Mplus User's Guide Version 8.pdf`; chapter excerpts also online via https://statmodel.com/ugexcerpts.shtml | 2026-10-16 |
| `mplus-ug-examples/inputs/` (591 files), `mplus-ug-examples/outputs/` (633 files), about 179 MB | The complete Mplus User's Guide example set, chapters 3 to 12, as shipped with Mplus: inputs (`.inp`) and data (`.dat`, including the shared `missimp*.dat` imputation files) in `inputs/`; the shipped outputs (`.out`), saved data and plot files (`.gh5`) in `outputs/`. `ex4.1part2.out`, `ex5.20.out`, `ex5.26.out`, `ex9.32.out` and `ex9.32b.out` contain `STDYX Standardization` sections, real fixtures for the `.out` parser. No `.dgm` diagrams ship with the examples. | Copied read-only, in chapter chunks with hash checks, from the local Mplus installation: `C:\Program Files\Mplus\Mplus Examples\User's Guide Examples` and its `Outputs` subfolder. Also online per chapter at https://www.statmodel.com/usersguide/ | 2026-10-16 |
| `mplus-runs/2026-10-16-ug/` | Seven User's Guide examples run with Mplus 8.11 through MplusAutomation 1.3, with `OUTPUT: STANDARDIZED` added and `/diagram` passed by a wrapper (`mplus-diagram.cmd`), so each has a matched `.inp`, `.out` (STDYX, STDY and STD sections) and `.dgm`: `ex3.11` path analysis, `ex5.1` CFA, `ex5.6` second-order factor, `ex5.8` CFA with covariates, `ex5.11` SEM, `ex5.14` multiple-group CFA, `ex5.20` CFA with constraints. Generated locally from the example copies; reproducible from them. | Run on 2026-10-16 from `mplus-ug-examples/` copies (never in the Mplus installation) with `tools/mplus/run-ug-examples.R` | 2026-10-16 |

## Read online, not saved

Useful sources found in the 2026-10-15 research; fetch on demand.

- Getting Started with Mplus 9.1.1 for Mac OS X (how a `.dgm` is created): https://statmodel.com/download/Getting_Started.pdf
- Diagram without analysis: https://www.StatModel.com/download/DiagramWithoutAnalysis.pdf
- Standardized coefficients in Mplus: https://www.StatModel.com/download/StandardizedCoefficients.pdf

Research notes that cite these (local only, in the ignored `_scratch/` folder):
`_scratch/research/2026-10-15-mplus-diagram-docs.md`,
`_scratch/research/2026-10-15-sem-notation.md`,
`_scratch/research/2026-10-15-sem-layout-and-tools.md`.
