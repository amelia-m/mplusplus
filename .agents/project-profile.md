# Project profile: mplusplus

Ownership: a personal project, not work for the university. Amelia, 2026-11-03: "it's not. it's work adjacent but a pet project on my own time" (asked whether the university may have a say in the license). The license is hers to choose: LGPL-3.0-or-later (Amelia, 2026-11-03).

Spelling: American English in everything committed here, code comments, docs, UI text, commit messages and pull requests (Amelia, 2026-11-03: "american english", asked "Licence" or "License"). Text written before 2026-11-03 still has British spellings ("licence", "behaviour", "colour", "organise" and so on); they are converted in one spelling-only commit once the open branches merge (open item in `TODO.md`), never mixed with content changes. Quotes keep their original spelling.

## Attribution

AI attribution in git and pull requests: yes. Amelia, 2026-10-16: "yes" (asked whether commits and PRs should carry AI attribution). The model must always be named (Amelia, 2026-10-16: "make sure model is specified"): commits end with a `Co-Authored-By:` trailer naming the exact model and version (for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); PR descriptions end with the "Generated with Claude Code" footer followed by the exact model and version (for example "Model: Claude Opus 5.5"). Merge commits carry the trailer too (Amelia, 2026-11-03: "y"): a merge an agent makes locally ends with it, and a pull request merged on GitHub gets it by editing the merge message or by squash-merging. Found 2026-11-03: of 69 commits on `main`, the 4 without it were all merges (GitHub's merge commits for #2, #3 and #4, and a local `Merge main into feat/sem-layout`).

Visible disclosure: the app's page and the README's "AI assistance" section carry the same credit line, in Amelia's wording (2026-11-03): "Designed by Amelia Miramonti and implemented with Claude Code (Anthropic)." No further detail (Amelia, 2026-11-03: model trailers in the README are "unneccessary detail"). Asked whether a deployed site needs a visible note: "y". This is not a UNL project (Amelia, 2026-11-03), so UNL's disclosure guideline does not govern it; the credit is her choice. Keep both copies identical, and update them if another assistant contributes (none did before the 2026-10-16 history reset: Amelia, 2026-11-03, "no").

## Review, push and merge

Level 2: agents may push their own branch after a clean local review; every merge waits for Amelia. Amelia, 2026-10-16: "2. Push after review".

- Clean local review: the branch's diff against `main` is reviewed with `/code-review` (the routing table's skill for a bug hunt on a branch), or by read-only review agents dispatched on that same diff; every finding is fixed or answered in the PR body, and `npm test` and `npm run build` (run in `app/`) pass.
- Push means the agent's own feature branch only, never `main`: `main` has no protection on GitHub (see below), so nothing but this rule stops a direct push.
- Level 2 delegates pushing only. Opening a pull request waits for Amelia, as does every merge.
- CI: none; `npm test` and `npm run build` output goes in the PR body.
- Still Amelia's at every level: merging, deleting branches or tags, force-pushing, rewriting history, repository settings.
- GitHub checked 2026-10-16 (`amelia-m/mplusplus`, public): no rulesets, no classic branch protection on `main`, `allow_auto_merge` false, `delete_branch_on_merge` false. Missing for this level: a ruleset on `main` with enforcement active, no bypass actors, and the rules `deletion`, `non_fast_forward` and `pull_request` (Settings > Rules > Rulesets, https://github.com/amelia-m/mplusplus/settings/rules). Automatic Copilot review is an account setting (https://github.com/settings/copilot/code_review): off. Amelia, 2026-10-26: "y" (asked whether automatic Copilot review is off).
