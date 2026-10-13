#!/usr/bin/env bash
set -euo pipefail
git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
merge_ref() {
    if git merge --no-edit "$1"; then return; fi
    conflicts=$(git diff --name-only --diff-filter=U)
    if [[ "$conflicts" != dsh-tavern-runtime.json ]]; then
        echo '::error::Source conflict requires manual resolution; no force push performed'
        git status --short
        return 1
    fi
    git checkout --ours dsh-tavern-runtime.json
    git add dsh-tavern-runtime.json
    git commit --no-edit
}
git fetch origin main
merge_ref origin/main
upstream_url=${DSH_UPSTREAM_GIT_URL:-https://github.com/flizzywine/dsh-tavern.git}
if git remote get-url upstream >/dev/null 2>&1; then
    git remote set-url upstream "$upstream_url"
else
    git remote add upstream "$upstream_url"
fi
git fetch upstream main
merge_ref upstream/main
# Preserve the upstream merge. Plain rebase would replay its complete history.
# Retry a concurrent manifest push by merging the refreshed fork, never rewriting it.
for attempt in 1 2 3; do
    if git push origin HEAD:main; then exit 0; fi
    git fetch origin main
    merge_ref origin/main
done
echo '::error::Could not push after three attempts'
exit 1
