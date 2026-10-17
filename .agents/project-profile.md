# Project profile: mplusplus

## Attribution

AI attribution in git and pull requests: yes. Amelia, 2026-10-16: "yes" (asked whether commits and PRs should carry AI attribution). Commits end with a `Co-Authored-By:` trailer naming the model; PR descriptions end with the "Generated with Claude Code" footer.

## Review, push and merge

Level 2: agents may push their own branch after a clean local review; every merge waits for Amelia. Amelia, 2026-10-16: "2. Push after review".

- Clean local review: code review agents are dispatched on the branch's diff against `main` (the review skill from the routing table), every finding is fixed or answered in the PR body, and `npm test` and `npm run build` (run in `app/`) pass.
- Push means the agent's own feature branch only, never `main`: `main` has no protection on GitHub (see below), so nothing but this rule stops a direct push.
- CI: none; `npm test` and `npm run build` output goes in the PR body.
- Still Amelia's at every level: merging, deleting branches or tags, force-pushing, rewriting history, repository settings.
- GitHub checked 2026-10-16 (`amelia-m/mplusplus`, public): no rulesets, no classic branch protection on `main`, `allow_auto_merge` false, `delete_branch_on_merge` false. Missing for this level: a ruleset on `main` with enforcement active, no bypass actors, and the rules `deletion`, `non_fast_forward` and `pull_request` (Settings > Rules > Rulesets, https://github.com/amelia-m/mplusplus/settings/rules). Automatic Copilot review is an account setting (https://github.com/settings/copilot/code_review): to be confirmed off.
