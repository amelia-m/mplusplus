# Claims in mplusplus-dev.qmd and their sources

Every date, count and named decision on a slide, with the command or file that supports it.
Commands run from the repository root on 2026-11-10, on `main` at 89f2517.

| # | Slide | Claim | Source |
|---|---|---|---|
| 1 | What it is | Live site URL opens | `curl -s -w '%{http_code}' https://amelia-m.github.io/mplusplus/`: 200, title "mplusplus - Mplus DGM Editor" |
| 2 | What it is | Repository URL opens | `curl` of https://github.com/amelia-m/mplusplus: 200 |
| 3 | What it is | LGPL-3.0-or-later | `README.md`, License section |
| 4 | What it is | Not affiliated with Muthén & Muthén | `README.md`, second paragraph |
| 5 | What it is | Nothing leaves the machine | `README.md`, Autosave bullet; `AGENTS.md` item 8 |
| 6 | Why | Parity is the minimum, not the aim; parity mode not built | `TODO.md`, "Project goal" and "Parity mode and how to demonstrate it" |
| 7 | Why | Mplus labels collide | `docs/diagram-conventions.md` D19 ("Departs from Mplus, whose labels collide") |
| 8 | Why / What it does | Features listed | `README.md`, Features |
| 9 | Timeline | First commit 2026-10-16, last on `main` 2026-11-09 | `git log --reverse --format=%ad --date=short main` (first and last) |
| 10 | Timeline | 207 commits, 48 merges | `git rev-list --count main`; `git rev-list --count --merges main` |
| 11 | Timeline | 18 pull requests merged | `git log main --merges --format=%s`: "Merge pull request #1" to "#18" |
| 12 | Timeline | Busiest days 2026-11-03 (49), 2026-11-04 (38) | `git log main --no-merges --format=%ad --date=short`, counted per day (non-merge commits) |
| 13 | Timeline | Live from PR #8, 2026-11-03 | `git log main --merges`: "#8 from amelia-m/ci/gh-pages" dated 2026-11-03; `.github/workflows/pages.yml` |
| 14 | Format | `INPUT_END` separator, undocumented estimate codes, digit scheme | `AGENTS.md` items 1 and "Allowed estimate codes"; `TODO.md` covariance item |
| 15 | Format | Level line inferred from 49 files and 11 diagrams, Mplus 8.11 only | `docs/diagram-conventions.md` D6 |
| 16 | Format | Fixtures synthetic plus openly licensed published models | `README.md`, Repository Structure; `dgm/README.md` |
| 17 | How it was built | "Designed by ... implemented with Claude Code (Anthropic)" | `.agents/project-profile.md`, Attribution |
| 18 | How it was built | Push after local review, merges wait | `.agents/project-profile.md`, Review, push and merge |
| 19 | Decisions | 19 decisions | `docs/diagram-conventions.md`, rows D1 to D19 |
| 20 | Decisions | Evidence levels; what counts as a source | `docs/diagram-conventions.md`, lines 5 and 7 |
| 21 | Decisions | Covariance curve example and its sources | `docs/diagram-conventions.md` D3 |
| 22 | Went sideways | Autosave: four review rounds, replaced with one slot per tab | `TODO.md`, "Autosave with two tabs open" |
| 23 | Went sideways | ELK EPL-2.0 only, 1,530 kB to 92 kB | `AGENTS.md` item 3 |
| 24 | Numbers | 85 TypeScript files, 36 test files in `app/src` | `git ls-files app/src`, counting `.ts` and `.test.ts` |
| 25 | Numbers | About 10,000 lines of non-test source | `git ls-files 'app/src/*.ts' \| grep -v test \| xargs cat \| wc -l`: 9,981 |
| 26 | Numbers | 602 passing, 1 skipped | `npx vitest run` in `app/`, 2026-11-10 |
| 27 | Numbers | 13 `.dgm` fixtures | `ls dgm/*.dgm \| wc -l` |
| 29 | How it was built | Task contract before dispatch; "I make the decisions" | Amelia's own agent rules (not in this repository); `.agents/project-profile.md` (every merge waits for Amelia). Personal statement |
| 30 | How it was built | Drawing and layout decisions recorded with source, who and when | `AGENTS.md`, "Sources for decisions"; `docs/diagram-conventions.md` |
| 31 | Went sideways | Inferred meanings labeled as inferred | `docs/diagram-conventions.md` line 7 (evidence levels) |
| 32 | What it does | Tolerant of header drift; styles by significance, sign and size | `AGENTS.md` items 1 and 7 |
| 28 | What is next | `.mdg`, more output types, `.dgm` writing | `TODO.md`, Mplus parity and extensions |
