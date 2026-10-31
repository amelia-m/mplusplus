# `.dgm` fixtures

Most files here are synthetic: an invented model with invented variable names,
fitted by Mplus to data that Mplus simulated (`MONTECARLO`). The rest come
from openly licensed (CC0 1.0) published replication packages,
listed under "Published models" below. No other research data, and nothing derived from
the Mplus User's Guide examples, goes in this folder. The parser and graph
test suites read every `.dgm` here at runtime.

| File | Model | Covers |
|---|---|---|
| `syn_sem.dgm` | Three factors (`fa`, `fb`, `fc`), a covariate `z1` and two outcomes (`x1`, `x2`) | Free (`*`) and fixed loadings; equality-constraint labels `la`, `lb` (code-91 rows); a structural chain `z1 -> fa -> fb -> fc`; a regression with two outcomes (`x1 x2 ON fc`); a declared residual covariance (`c4 WITH b4`); an undeclared residual covariance Mplus estimates by default (`x1`, `x2`), which becomes a COVAR edge; codes 1, 2, 4, 11, 12, 14, 21, 22, 24, 31, 32, 34, 91 |
| `syn_twofactor.dgm` | Two factors (`fp`, `fq`) predicting `r1` | An undeclared factor covariance (default), which becomes a COVAR edge; latent variance codes 5, 15, 25, 35 |
| `syn_path.dgm` | Path analysis with no latent variables: `k1`, `k2` -> `m1` -> `d1`, `d2`, plus `k3 -> d1` and `k1 -> d2` | A groupings count of 0 in the header; a declared residual covariance (`d1 WITH d2`); code-2 rows with the 999.000 sentinel for the covariances among the exogenous `k1`, `k2`, `k3`, which become COVAR edges |
| `syn_cint.dgm` | The `syn_sem` model and data, with `OUTPUT: STANDARDIZED CINTERVAL` | Estimate rows with 95% confidence limits: 8-token edge rows and 7-token variance rows (`<est> <se> <lower 2.5%> <upper 2.5%>`); a header whose first line is 3, not 2 |
| `syn_range.dgm` | Two factors (`fg`, `fh`) regressed on `t1`, predicting `t2` | Mplus list ranges: generated names in NAMES (`g1-g4`), a USEVARIABLES range that leaves out `e1` (`g1-t2`), a modifier on an indicator range (`g1-g4*`), a label on a range (`h2-h4 (lh)`, code-91 rows), latent ranges on both sides of ON (`fg-fh ON t1`, `t2 ON fg-fh`) |
| `syn_label.dgm` | The `syn_sem` model and data, with equality labels on loadings (`la`), on two covariances (`c4 WITH b4 (cv); x1 WITH x2 (cv);`) and on two residual variances (`rv`) | Constraint-label rows 91 (loading), 92 (covariance) and 94 (residual variance); 95 (latent variance) is not in this fixture and is tested with a hand-written row in `dgm.test.ts` |

`app/test/fixtures/sample.out` is the Mplus output of the `syn_sem` model, with
`OUTPUT: STANDARDIZED` (STDYX, STDY and STD sections).

## Published models

From the replication package of Verkuyten et al., Journal of Experimental
Political Science: Harvard Dataverse, doi:10.7910/DVN/BA20LQ, licensed CC0 1.0.
Its Mplus inputs were run unchanged with Mplus 8.11 and `/diagram` on
2026-10-22. The `.dgm` holds the input and the estimates only, not the survey
data.

| File | Model | Covers |
|---|---|---|
| `dc_tol_cfa_step3.dgm` | Three-factor CFA (`l_hc`, `l_oc`, `poltol`), MLR | A real researcher's input; latent variance and covariance codes 5, 15, 35 and 2, 12, 32 |
| `dc_tol_cfaallcorrelations.dgm` | The same CFA, with four observed variables (`V051`, `LFT`, `OPL`, `GSL_R`) correlated `WITH` the factors and each other | Many covariance rows (23 per code): 20 land on declared WITH edges (2 residual covariances, 18 correlations), 3 undeclared factor covariances become COVAR edges; a bare variance statement (`V051;`) |
| `dc_tol_sem.dgm` | SEM with mediators | `OUTPUT: CINTERVAL` in a real model: every estimate row carries confidence limits (the parser read 0 rows before 2026-10-26) |

To regenerate: download the package, copy its `.inp` files and
`Tolerance2021.dat` into a scratch folder, run `Mplus <input> /diagram`, and
copy the lower-cased `.dgm` here.

The files below were run with Mplus 8.11 and `/diagram` on 2026-10-30. Each
`.dgm` holds the (adapted) input and the estimates only, not the data. The
only change to the CC0 inputs is the `FILE` path, set to the local data file
name.

| File | Source and licence | Model | Covers |
|---|---|---|---|
| `lcsmcn.dgm` | Golec de Zavala and Federico, replication data, Harvard Dataverse doi:10.7910/DVN/LW0GTR, CC0 1.0 (`lcsmcn.inp`) | Latent change score model: a change factor `chct1` measured by `rcp014@1`, regressed on the earlier score and 13 covariates, MLR | Bracketed means and bare variance statements; `@` with no value; a `WEIGHT` variable listed in USEVARIABLES; 78 undeclared covariances among the exogenous covariates, which become COVAR edges; `OUTPUT: CINT` |
| `ms_fig2.dgm` | Mader and Schoen, "Stability of national identity content", Political Psychology (2023), doi:10.1111/pops.12888; replication data Harvard Dataverse doi:10.7910/DVN/P6XU2N, CC0 1.0 (`Mplus 01 Figure 2.inp`) | Two factors measured at four waves (8 factors, 24 categorical indicators), cross-lagged, WLSMV | Numeric equality labels on loadings (`(1)` to `(6)`); residual covariances across waves; threshold statements (`[et_anc1$1 ...]`); a predictor repeated in one ON statement (`ETH_2 on ETH_1 ETH_1`); two undeclared factor covariances (COVAR) |
| `idnfc41b.dgm` | Federico and Ekstrom, "The Political Self", Psychological Science (2017); replication data Harvard Dataverse doi:10.7910/DVN/OE9BNP, CC0 1.0 (`idnfc41b.inp`) | Two-group SEM (`GROUPING IS rsdic`): two factors, two mediators, six covariates, ML | A multi-group model with a group-specific `MODEL high:` section and labels that differ by group; bootstrap confidence limits (`CINTERVAL(BCBOOTSTRAP)`). Known wrong today: the second group's estimates and labels overwrite the first group's on each edge (multi-group decision in `TODO.md`) |
To regenerate these: download the files named above into
`docs/reference/public-models/<set>/` (set names are in
`tools/mplus/run-public-models.py`) and run
`python -I tools/mplus/run-public-models.py <run name>`, or by hand: copy
the input and its data into a scratch folder, set the `FILE` path, and run
`Mplus <input> /diagram`.

Not used, and why: mixture models (`TYPE = MIXTURE`: the latent class
analysis of Harvard Dataverse DVN/ICPFRE, the latent profile analysis in
Zenodo 14575311 and the Bayesian known-class models of DVN/TPGPCR) produce no
diagram in Mplus ("Mplus diagrams are currently not available for Mixture
analysis"). The other Mader and Schoen models and the CFA of Zenodo 14575311
were run but repeat structures already covered. The CFA of Zenodo 14601030
(CC BY 4.0) is held back until the parser reads the abbreviated `USEV`
keyword it uses (see `TODO.md`).

## Regenerating

The inputs are in `tools/mplus/synthetic/`. With Mplus installed (8.11 was
used), in a scratch folder holding copies of those inputs:

1. `Mplus gen_syn_sem.inp` simulates `syn_sem.dat` (fixed `SEED`, so the data
   are reproducible).
2. `Mplus syn_sem.inp /diagram` fits the model and writes `syn_sem.out` and
   `syn_sem.dgm`.

Do the same for `syn_twofactor`, `syn_path` and `syn_range`; `syn_cint.inp`
and `syn_label.inp` read the `syn_sem.dat` from step 1. Copy the `.dgm`
here, and `syn_sem.out` to `app/test/fixtures/sample.out`. Regenerated files
keep the same structure; if any estimate shifts, update the spot-check values
in the tests.

`MONTECARLO` saves the data with dependent variables first and covariates
last (the "Order of variables" list under SAVEDATA INFORMATION in the
generation output), so each generation input lists NAMES in that order and the
fitting input reads the data with the same NAMES.
