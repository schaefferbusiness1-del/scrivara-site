#!/usr/bin/env bash
# Audit worker branches FOR CONTENT, by the only method that has proven reliable here.
#
# WHY NOT grep: a marker-string search printed "HEAD:0 perfbranch:0" today and was
# read as absence. The strings existed in neither branch. Grep cannot answer this.
#
# WHY NOT `git diff HEAD...branch`: three-dot diffs merge-base..branch, so it shows
# everything the branch changed since diverging EVEN IF HEAD already contains the
# same content by a rebase. That is exactly the perf-branch trap: it would have
# reported 975 lines when the real answer was 2.
#
# WHY NOT merge-tree: it reported "changed in both" with zero conflict markers on
# files that then produced three real conflicts in an actual merge.
#
# THE METHOD THAT SETTLED IT: merge into a throwaway worktree and read the STAGED
# diff against HEAD. That answers precisely "what would applying this branch change
# about my tree", which is the actual question.
#
# The live repo is never touched: one detached worktree, reset between branches.
set -u

REPO="C:/Users/Micha/Desktop/MLS_EVERYTHING/dispatch-work/claude-qa-txm-20260725"
LANE="C:/Users/Micha/AppData/Local/Temp/claude/C--Users-Micha-Desktop-MLS-EVERYTHING/a8e91f01-94d9-4615-8908-6c26ca892b07/scratchpad/branch-audit-lane"
OUT="C:/Users/Micha/AppData/Local/Temp/claude/C--Users-Micha-Desktop-MLS-EVERYTHING/a8e91f01-94d9-4615-8908-6c26ca892b07/scratchpad/branch-audit-report.txt"

BRANCHES="worker-a-ui worker-d-visit worker-d2-advworkspace worker-e-views worker-e2-studio worker-e3-studio worker-f-theme worker-f2-motion worker-f3-motion worker-g-voice worker-g2-voice worker-h-polish worker-i-parse worker-j-ext322"

cd "$REPO" || exit 1
git worktree remove --force "$LANE" 2>/dev/null
git worktree prune
git worktree add --detach "$LANE" HEAD >/dev/null 2>&1 || { echo "worktree add failed"; exit 1; }

: > "$OUT"
printf "%-26s %7s %7s %8s  %s\n" "BRANCH" "FILES" "+LINES" "CONFLICT" "VERDICT" | tee -a "$OUT"
printf -- "----------------------------------------------------------------------------------\n" | tee -a "$OUT"

cd "$LANE" || exit 1
for b in $BRANCHES; do
  git merge --abort >/dev/null 2>&1
  git reset --hard HEAD >/dev/null 2>&1
  git clean -fd >/dev/null 2>&1

  git merge --no-commit --no-ff "$b" >/tmp/mergeout.txt 2>&1
  CONF=$(git diff --name-only --diff-filter=U 2>/dev/null | wc -l | tr -d ' ')

  # stage everything non-conflicted so the diff reflects the real delta
  git add -A >/dev/null 2>&1
  STAT=$(git diff --cached --shortstat HEAD 2>/dev/null)
  FILES=$(git diff --cached --name-only HEAD 2>/dev/null | wc -l | tr -d ' ')
  ADDS=$(echo "$STAT" | grep -o '[0-9]* insertion' | grep -o '[0-9]*'); ADDS=${ADDS:-0}

  # what KIND of change: are the differing files only tests/docs, or real source?
  SRC=$(git diff --cached --name-only HEAD 2>/dev/null | grep -Ev '^(tests/|.*\.md$)' | wc -l | tr -d ' ')

  if [ "$FILES" = "0" ]; then
    V="EMPTY - content already in HEAD"
  elif [ "$SRC" = "0" ]; then
    V="tests/docs only ($FILES files)"
  else
    V="REAL CONTENT - $SRC source file(s)"
  fi
  [ "$CONF" != "0" ] && V="$V [${CONF} conflicted]"

  printf "%-26s %7s %7s %8s  %s\n" "$b" "$FILES" "$ADDS" "$CONF" "$V" | tee -a "$OUT"

  # for anything with real content, record which files
  if [ "$SRC" != "0" ]; then
    git diff --cached --name-only HEAD 2>/dev/null | grep -Ev '^(tests/|.*\.md$)' | head -8 | sed 's/^/      /' | tee -a "$OUT"
  fi
done

git merge --abort >/dev/null 2>&1
git reset --hard HEAD >/dev/null 2>&1
cd "$REPO" || exit 1
git worktree remove --force "$LANE" >/dev/null 2>&1
git worktree prune
echo "" | tee -a "$OUT"
echo "lane removed; live repo untouched" | tee -a "$OUT"
