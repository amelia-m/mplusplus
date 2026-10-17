# Synthetic `.dgm` fixtures

Every file here is synthetic: an invented model with invented variable names,
fitted by Mplus to data that Mplus simulated (`MONTECARLO`). No research data,
and nothing derived from the Mplus User's Guide examples, goes in this folder.
The parser and graph test suites read every `.dgm` here at runtime.

| File | Model | Covers |
|---|---|---|
| `syn_sem.dgm` | Three factors (`fa`, `fb`, `fc`), a covariate `z1` and two outcomes (`x1`, `x2`) | Free (`*`) and fixed loadings; equality-constraint labels `la`, `lb` (code-91 rows); a structural chain `z1 -> fa -> fb -> fc`; a regression with two outcomes (`x1 x2 ON fc`); a declared residual covariance (`c4 WITH b4`); an undeclared residual covariance Mplus estimates by default (`x1`, `x2`), which becomes a COVAR edge; codes 1, 2, 4, 11, 12, 14, 21, 22, 24, 31, 32, 34, 91 |
| `syn_twofactor.dgm` | Two factors (`fp`, `fq`) predicting `r1` | An undeclared factor covariance (default), which becomes a COVAR edge; latent variance codes 5, 15, 25, 35 |

`app/test/fixtures/sample.out` is the Mplus output of the `syn_sem` model, with
`OUTPUT: STANDARDIZED` (STDYX, STDY and STD sections).

## Regenerating

The inputs are in `tools/mplus/synthetic/`. With Mplus installed (8.11 was
used), in a scratch folder holding copies of those inputs:

1. `Mplus gen_syn_sem.inp` simulates `syn_sem.dat` (fixed `SEED`, so the data
   are reproducible).
2. `Mplus syn_sem.inp /diagram` fits the model and writes `syn_sem.out` and
   `syn_sem.dgm`.

Do the same for `syn_twofactor`. Copy the `.dgm` here, and `syn_sem.out` to
`app/test/fixtures/sample.out`. Regenerated files keep the same structure; if
any estimate shifts, update the spot-check values in the tests.
