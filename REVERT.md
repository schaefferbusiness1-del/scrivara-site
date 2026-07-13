# EMERGENCY REVERT — "DING DONG" procedure

**Backup point:** tag `pre-redesign-b173-backup` = commit `1cdaf3c1a11760276f4e64cfc01bfc1287586043`
(build **b173**, the last live production state before the 2026-07-12 full UI redesign).
The tag is pushed to `origin` (github.com/schaefferbusiness1-del/scrivara-site), so it survives
any local machine loss.

Production = GitHub Pages serving `mlsscribe.com` directly from `main`. Restoring `main` to the
tagged commit restores production byte-identically (git is content-addressed: same commit hash
⇒ identical tree ⇒ identical served files). Pages republishes ~1–2 min after the push.

## THE ONE COMMAND (from any clone of the repo)

```
git fetch origin tag pre-redesign-b173-backup && git push --force origin pre-redesign-b173-backup:refs/heads/main
```

Fallback (identical effect, no tag needed — raw SHA):

```
git fetch origin && git push --force origin 1cdaf3c1a11760276f4e64cfc01bfc1287586043:refs/heads/main
```

Then confirm production: `https://mlsscribe.com/mls-connect.js` should contain build marker
`2026-07-12-b173` within ~2 minutes (hard-refresh / cache-bust with `?dingdong=1`).

## Why force-push instead of a revert commit

- **Force-push (chosen):** single command, restores the *exact* commit — provably byte-identical,
  nothing to re-generate. The redesign commits are NOT destroyed: they stay reachable via reflog
  and via any tags/branches pointing at them; work can be re-pushed later. This procedure was
  **actually tested 2026-07-12** on a throwaway branch (`revert-drill`): a junk commit was pushed,
  the command above (targeting the drill branch) restored it to `1cdaf3c...` exactly, verified via
  `git ls-remote`. Force-push is confirmed permitted on this remote (no branch protection).
- **Revert-commit (alternative):** `git commit-tree pre-redesign-b173-backup^{tree} -p <current-head> -m "revert"`
  then a normal push. Preserves linear history and works even where force-push is blocked, but is
  two steps, easier to fumble under pressure, and the "byte-identical" guarantee is of the *tree*,
  not the commit. Use only if force-push is ever rejected.

## Notes

- After a revert, if a newer MLS Assist extension version has been distributed in the meantime,
  the b173 site pairs with extension **v2.9.3** (staged zip: `Desktop`/`Downloads\MLS_Assist_v1.65`
  lineage — see dispatch-work docs). App-side b173 works with v2.9.3.
- This file also exists at `MLS_EVERYTHING\dispatch-work\REVERT.md` in case the repo clone is gone.
