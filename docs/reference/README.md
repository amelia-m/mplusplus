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
| `mplus-runs/2026-10-22-verkuyten/` | The 14 Verkuyten et al. inputs (below) run unchanged with Mplus 8.11 through MplusAutomation 1.3, with `/diagram` passed by a wrapper: 14 `.out`, 13 `.dgm` (`OnlyExpConditions` stops on an error in the package's own input). The five `dc_tol_sem*` models use `OUTPUT: CINTERVAL`, so their `.dgm` rows carry confidence limits. | Run on 2026-10-22 from copies of `public-models/verkuyten-2022/` by a one-off script (`_scratch/run_verkuyten.R`, local) | 2026-10-22 |
| `mplus-runs/2026-10-26-runner-check/` | Check of `tools/mplus/run-ug-examples.R` after the 2026-10-26 fixes: `ex5.1`, and three examples whose data files are named outside a DATA `FILE` statement or in list files (`ex12.7step2` POPULATION/COVERAGE, `ex11.8part3` imputation and SWMATRIX lists, `ex12.6step2` replication list). All four run without Mplus errors; only `ex5.1` has a `.dgm`, as Mplus writes none for Monte Carlo or multilevel analyses. | Run on 2026-10-26 with `tools/mplus/run-ug-examples.R` | 2026-10-26 |
| `public-models/verkuyten-2022/` (32 files, 682,515 bytes, plus the download zip) | Replication package for Verkuyten et al., Journal of Experimental Political Science: 14 Mplus inputs with their 14 outputs (stepwise CFAs, SEMs with mediators, Wald tests), the data (`Tolerance2021.dat`), an SPSS file and a ReadMe PDF. Openly licensed (CC0 1.0), so derived fixtures may be committed; the copy here stays local like the rest of this folder. | Harvard Dataverse, doi:10.7910/DVN/BA20LQ, https://dataverse.harvard.edu/dataset.xhtml?persistentId=doi:10.7910/DVN/BA20LQ (downloaded with the Dataverse access API) | 2026-10-22 |
| `public-models/golec-federico-lcs/`, `mader-schoen-2023/`, `federico-ekstrom-2017/`, `segmentation-lca/`, `sokolov-2018/` | Selected files of five more CC0 1.0 replication packages: the Mplus inputs and their `.dat` data (latent change score model; longitudinal categorical CFA/SEM; two-group SEM; latent class analysis, with its `.out`; 27 Bayesian known-class and per-zone inputs plus `WVS_1.dat`). Not the Stata, `.tab` or `.sav` copies. | Harvard Dataverse doi:10.7910/DVN/LW0GTR, doi:10.7910/DVN/P6XU2N, doi:10.7910/DVN/OE9BNP, doi:10.7910/DVN/ICPFRE, doi:10.7910/DVN/TPGPCR (licence and file list read from the Dataverse API; files downloaded with its access API; sizes match the listing) | 2026-10-30 |
| `public-models/pcwas-zenodo-14601030/`, `iwas-zenodo-14575311/` | Work addiction scale packages (CC BY 4.0): Mplus syntax as `.txt` (CFA, multi-group CFA, alignment, SEM; CFA, multi-group CFA, LPA), `Data.csv` (semicolon-separated, with a header), codebooks and READMEs. Not the `.xlsx` copies. | Zenodo doi:10.5281/zenodo.14601030 and doi:10.5281/zenodo.14575311 (records API) | 2026-10-30 |
| `mplus-runs/2026-10-30-public/` | The models above run with Mplus 8.11 and `/diagram` on adapted copies (data path set, Zenodo CSV converted): `.dgm` for the latent change score model, the three Mader and Schoen models, the two-group SEM and the two Zenodo CFAs. The latent class analysis ran and Mplus wrote no diagram ("not available for Mixture analysis"), so the Sokolov wave 1 run (also a mixture) was stopped and the IWAS LPA was not run. Three became fixtures (see `dgm/README.md`); the PCWAS CFA waits on the parser reading `USEV`. `mplus-runs/2026-10-30-scriptcheck/` reruns two of them with the committed script; the `.dgm` files are byte-identical to the fixtures. | Run on 2026-10-30, first by a scratch script, then by `tools/mplus/run-public-models.py` | 2026-10-30 |

## Read online, not saved

Useful sources found in the 2026-10-15 research; fetch on demand.

- Getting Started with Mplus 9.1.1 for Mac OS X (how a `.dgm` is created): https://statmodel.com/download/Getting_Started.pdf
- Diagram without analysis: https://www.StatModel.com/download/DiagramWithoutAnalysis.pdf
- Standardized coefficients in Mplus: https://www.StatModel.com/download/StandardizedCoefficients.pdf

Research notes that cite these (local only, in the ignored `_scratch/` folder):
`_scratch/research/2026-10-15-mplus-diagram-docs.md`,
`_scratch/research/2026-10-15-sem-notation.md`,
`_scratch/research/2026-10-15-sem-layout-and-tools.md`.
