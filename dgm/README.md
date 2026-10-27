# Synthetic `.dgm` fixtures

Every file here is synthetic: an invented model with invented variable names,
fitted by Mplus to data that Mplus simulated (`MONTECARLO`). No research data,
and nothing derived from the Mplus User's Guide examples, goes in this folder.
The parser and graph test suites read every `.dgm` here at runtime.

| File | Model | Covers |
|---|---|---|
| `syn_sem.dgm` | Three factors (`fa`, `fb`, `fc`), a covariate `z1` and two outcomes (`x1`, `x2`) | Free (`*`) and fixed loadings; equality-constraint labels `la`, `lb` (code-91 rows); a structural chain `z1 -> fa -> fb -> fc`; a regression with two outcomes (`x1 x2 ON fc`); a declared residual covariance (`c4 WITH b4`); an undeclared residual covariance Mplus estimates by default (`x1`, `x2`), which becomes a COVAR edge; codes 1, 2, 4, 11, 12, 14, 21, 22, 24, 31, 32, 34, 91 |
| `syn_twofactor.dgm` | Two factors (`fp`, `fq`) predicting `r1` | An undeclared factor covariance (default), which becomes a COVAR edge; latent variance codes 5, 15, 25, 35 |
| `syn_path.dgm` | Path analysis with no latent variables: `k1`, `k2` -> `m1` -> `d1`, `d2`, plus `k3 -> d1` and `k1 -> d2` | A groupings count of 0 in the header; a declared residual covariance (`d1 WITH d2`); code-2 rows with the 999.000 sentinel for the covariances among the exogenous `k1`, `k2`, `k3`, which become COVAR edges |
| `syn_cint.dgm` | The `syn_sem` model and data, with `OUTPUT: STANDARDIZED CINTERVAL` | Estimate rows with 95% confidence limits: 8-token edge rows and 7-token variance rows (`<est> <se> <lower 2.5%> <upper 2.5%>`); a header whose first line is 3, not 2 |
| `syn_range.dgm` | Two factors (`fg`, `fh`) regressed on `t1`, predicting `t2` | Mplus list ranges: generated names in NAMES (`g1-g4`), a USEVARIABLES range that leaves out `e1` (`g1-t2`), a modifier on an indicator range (`g1-g4*`), a label on a range (`h2-h4 (lh)`, code-91 rows), latent ranges on both sides of ON (`fg-fh ON t1`, `t2 ON fg-fh`) |
| `syn_label.dgm` | The `syn_sem` model and data, with equality labels on loadings (`la`), on two covariances (`c4 WITH b4 (cv); x1 WITH x2 (cv);`) and on two residual variances (`rv`) | Constraint-label rows of every seen type: 91 (loading), 92 (covariance), 94 (residual variance) |

`app/test/fixtures/sample.out` is the Mplus output of the `syn_sem` model, with
`OUTPUT: STANDARDIZED` (STDYX, STDY and STD sections).

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
