# Project profile: mplusplus

## Attribution

AI attribution in git and pull requests: yes. Amelia, 2026-10-16: "yes" (asked whether commits and PRs should carry AI attribution). The model must always be named (Amelia, 2026-10-16: "make sure model is specified"): commits end with a `Co-Authored-By:` trailer naming the exact model and version (for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`); PR descriptions end with the "Generated with Claude Code" footer followed by the exact model and version (for example "Model: Claude Opus 5.5").

## Review, push and merge

Level 2: agents may push their own branch after a clean local review; every merge waits for Amelia. Amelia, 2026-10-16: "2. Push after review".

- Clean local review: the branch's diff against `main` is reviewed with `/code-review` (the routing table's skill for a bug hunt on a branch), or by read-only review agents dispatched on that same diff; every finding is fixed or answered in the PR body, and `npm test` and `npm run build` (run in `app/`) pass.
- Push means the agent's own feature branch only, never `main`: `main` has no protection on GitHub (see below), so nothing but this rule stops a direct push.
- Level 2 delegates pushing only. Opening a pull request waits for Amelia, as does every merge.
- CI: none; `npm test` and `npm run build` output goes in the PR body.
- Still Amelia's at every level: merging, deleting branches or tags, force-pushing, rewriting history, repository settings.
- GitHub checked 2026-10-16 (`amelia-m/mplusplus`, public): no rulesets, no classic branch protection on `main`, `allow_auto_merge` false, `delete_branch_on_merge` false. Missing for this level: a ruleset on `main` with enforcement active, no bypass actors, and the rules `deletion`, `non_fast_forward` and `pull_request` (Settings > Rules > Rulesets, https://github.com/amelia-m/mplusplus/settings/rules). Automatic Copilot review is an account setting (https://github.com/settings/copilot/code_review): off. Amelia, 2026-10-26: "y" (asked whether automatic Copilot review is off).
