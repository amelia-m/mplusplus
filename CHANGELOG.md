# Changelog

The git history was reset on 2026-10-16 to a single new root commit, so that
no earlier version of any file held the original test corpus (research model
files, replaced by synthetic fixtures). This file records what the earlier 25
commits did, newest first. It names no corpus files or values.

## 2026-10-16

- **Test corpus replaced with synthetic fixtures.** The `.dgm` corpus, a
  reference rendering derived from it and the `.out` test fixture were removed.
  `dgm/` now holds invented models fitted by Mplus to simulated data
  (`dgm/README.md`, inputs in `tools/mplus/synthetic/`), and
  `app/test/fixtures/sample.out` is real Mplus output of one of them.
- **`.out` parser reads real Mplus output.** STDYX rows are found when Mplus
  prints `STDYX Standardization` on its own line (it always does in v8);
  STDY and STD rows no longer fold into STDYX.
- **`.gitattributes` added**, pinning LF line endings.
- **Covariance curves reverted.** An attempt to leave WITH/COVAR edges out of
  the layout and draw them as curves made curves cut through nodes; reverted
  pending the SEM-aware layout in the style-preset redesign.
- **Mplus example runs.** User's Guide examples run through MplusAutomation
  with `/diagram` and `OUTPUT: STANDARDIZED` (`tools/mplus/run-ug-examples.R`);
  findings recorded in `TODO.md` (STDY codes, unexpanded list ranges, models
  without latents losing their estimates).
- **Project profile** (`.agents/project-profile.md`): level 2, agents may push
  their own branch after a clean local review; merges wait for Amelia.
- **Reference index** (`docs/reference/README.md`): local, gitignored copies of
  the Mplus Diagrammer guide, User's Guide and example set.
- **Branch review fixes.** Estimate rows match edges by direction; one modifier
  grammar for term lists and standalone statements; touch drag no longer
  freezes; edits that change nothing add no undo step; a failed relayout shows
  an error; window drops intercept only file drags.

## 2026-10-15

- **Node drag and undo restored.** Dragging was broken outright (the code
  called a zundo function that does not exist). A gesture module now gives one
  undo step per drag or slider scrub, with a 3 px click threshold, group drag,
  and arrowheads that meet ellipse and diamond outlines.
- **UI fixes.** Working sliders, a canvas that fits the diagram, clamped number
  inputs, case-insensitive undo/redo keys that leave text fields alone, the
  inspector showing effective styles, safe file drops, an accurate `.out`
  message, re-picking the same file.
- **Parser and model fixes.** Start values (`y2*0.8`), `NAMES ARE` syntax, one
  edge per covariance pair, `.out` p-value keys for COVAR edges, the `999.000`
  placeholder read as no p-value.
- **Docs.** README and AGENTS.md refreshed; module summaries; `TODO.md` added.

## 2026-10-14

- AGENTS.md: estimate-code allow-list corrected; `.out` path documented.

## 2026-09-05 to 2026-09-06

- `.out` parsing, inspector and styles added.
- Governance: Clanker Constitution inlined into AGENTS.md; project profile.
- Em dashes replaced throughout; top-level README added.

## 2026-05-08

- Initial app scaffold: parser, graph, ELK layout, SVG render, interaction.
