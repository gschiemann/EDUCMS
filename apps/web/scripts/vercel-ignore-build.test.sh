#!/bin/sh
# Replays Vercel's checkout for `vercel-ignore-build.sh` and checks every
# answer. Usage: sh vercel-ignore-build.test.sh [path-to-script-under-test]
#
# WHY THIS EXISTS (2026-11-15). The first-push rule shipped and did not work
# inside Vercel: its base came from `git fetch origin master`, and that fetch
# does not succeed in Vercel's checkout. It had been tried by hand in a
# scratch repository that DID have an `origin`, and inside Vercel only on a
# branch that changed the web, where BUILD was the right answer anyway. So
# this test builds the checkout the way Vercel does - `git clone --depth=10`
# of one branch, then no remote at all - and it never touches the network:
# the script's GitHub URL is rewritten to a local bare repository (or, for
# the unreachable cases, to a path that does not exist).
#
# Exit 0 = every scenario answered as expected. No install, a few seconds.
set -u

here="$(cd "$(dirname "$0")" && pwd)"
script="${1:-$here/vercel-ignore-build.sh}"
[ -f "$script" ] || { echo "no script at $script"; exit 2; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# Hermetic: no machine-wide or per-user git configuration reaches the replay.
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM
GITHUB_URL="https://github.com/gschiemann/EDUCMS.git"
bare="$tmp/github.git"
work="$tmp/work"
nowhere="$tmp/does-not-exist.git"
fails=0
count=0

g() {
  git -c user.name=test -c user.email=test@example.invalid -c commit.gpgsign=false \
    -c init.defaultBranch=master -c advice.detachedHead=false -c protocol.file.allow=always "$@"
}

# ── the repository as GitHub holds it ────────────────────────────────────
g init -q --bare "$bare"
g -C "$bare" config uploadpack.allowAnySHA1InWant true
g init -q "$work"
cd "$work" || exit 2
mkdir -p apps/web/src apps/api packages/p docs
echo 1 > apps/web/src/page.txt
echo 1 > apps/api/main.txt
echo 1 > packages/p/index.txt
echo 1 > docs/readme.md
echo '{}' > package.json
echo lock > pnpm-lock.yaml
echo '{}' > turbo.json
g add -A && g commit -q -m "m0"
# master is deeper than the ten commits Vercel clones.
i=1
while [ "$i" -le 14 ]; do
  echo "$i" > docs/history.md
  g add -A && g commit -q -m "master docs $i"
  i=$((i + 1))
done
g branch -M master
g remote add origin "$bare"
g push -q origin master

# branch <name> <file> [<file>...]: one commit on a new branch cut from master.
branch() {
  name="$1"
  shift
  g checkout -q master && g checkout -q -b "$name" || exit 2
  for f in "$@"; do echo "$name" >> "$f"; done
  g add -A && g commit -q -m "$name" && g push -q origin "$name"
}
# more <file>: one more commit on the current branch; prints nothing.
more() {
  echo "more $(date +%s%N)" >> "$1"
  g add -A && g commit -q -m "more $1" && g push -q origin HEAD
}

# vercel_checkout <ref> <url-target> [keep-origin]: what the build machine has.
vercel_checkout() {
  count=$((count + 1))
  dir="$tmp/checkout-$count"
  g clone -q --depth=10 --branch "$1" "file://$bare" "$dir" || exit 2
  if [ "${3:-}" != "keep-origin" ]; then g -C "$dir" remote remove origin; fi
  g -C "$dir" config "url.file://$2.insteadOf" "$GITHUB_URL"
  g -C "$dir" config protocol.file.allow always
}

# expect <0|1> <label> [VAR=value ...]: run the script in the last checkout.
expect() {
  want="$1"
  label="$2"
  shift 2
  out="$(cd "$dir/apps/web" && env -i PATH="$PATH" HOME="$tmp" GIT_TERMINAL_PROMPT=0 \
    VERCEL_GIT_REPO_OWNER=gschiemann VERCEL_GIT_REPO_SLUG=EDUCMS "$@" sh "$script" 2>&1)"
  got=$?
  verdict="$(printf '%s\n' "$out" | grep -E '^\[ignore-build\] (SKIP|BUILD):' | tail -1)"
  if [ "$got" != "$want" ]; then
    fails=$((fails + 1))
    echo "FAIL  $label: exit $got, wanted $want"
    printf '%s\n' "$out" | sed 's/^/        /'
  elif [ -z "$verdict" ]; then
    fails=$((fails + 1))
    echo "FAIL  $label: exit $got as wanted, but no SKIP:/BUILD: line was printed"
  elif printf '%s' "$out" | grep -q '://'; then
    fails=$((fails + 1))
    echo "FAIL  $label: the output contains an address"
  else
    echo "ok    $label -> $got"
  fi
}

sha() { g -C "$work" rev-parse "$1"; }

# ── a branch's FIRST deployment (VERCEL_GIT_PREVIOUS_SHA is empty) ───────
branch docs-only docs/readme.md
vercel_checkout docs-only "$bare"
expect 0 "first push, docs only, no remote in the checkout" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=docs-only

branch api-only apps/api/main.txt
vercel_checkout api-only "$bare"
expect 0 "first push, API only" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=api-only

branch web-change apps/web/src/page.txt
vercel_checkout web-change "$bare"
expect 1 "first push, web source changed" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=web-change

branch pkg-change packages/p/index.txt
vercel_checkout pkg-change "$bare"
expect 1 "first push, a workspace package changed" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=pkg-change

branch lock-change pnpm-lock.yaml
vercel_checkout lock-change "$bare"
expect 1 "first push, lockfile changed" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=lock-change

branch deep-docs docs/readme.md
i=1
while [ "$i" -le 12 ]; do more docs/history.md; i=$((i + 1)); done
vercel_checkout deep-docs "$bare"
expect 0 "first push, 13 docs commits (deeper than the clone)" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=deep-docs

vercel_checkout docs-only "$nowhere"
expect 1 "first push, docs only, repository unreachable" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=docs-only

vercel_checkout docs-only "$nowhere" keep-origin
expect 0 "first push, docs only, URL refused but origin works" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=docs-only

vercel_checkout master "$bare"
expect 1 "production branch with no previous deployment" VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=master

vercel_checkout master "$bare"
expect 1 "a branch named master is never judged as a preview" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=master

vercel_checkout docs-only "$bare"
expect 1 "no previous deployment and no VERCEL_ENV" VERCEL_GIT_COMMIT_REF=docs-only

# ── a LATER deployment (VERCEL_GIT_PREVIOUS_SHA is the last built commit) ─
branch later apps/web/src/page.txt
prev="$(sha later)"
more docs/readme.md
vercel_checkout later "$bare"
expect 0 "later push, docs only since the last build" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=later VERCEL_GIT_PREVIOUS_SHA="$prev"
more apps/web/src/page.txt
vercel_checkout later "$bare"
expect 1 "later push, web changed since the last build" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=later VERCEL_GIT_PREVIOUS_SHA="$prev"

branch far docs/readme.md
prev="$(sha far)"
i=1
while [ "$i" -le 12 ]; do more docs/history.md; i=$((i + 1)); done
vercel_checkout far "$bare"
expect 0 "last build is outside the clone, docs only since" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=far VERCEL_GIT_PREVIOUS_SHA="$prev"
vercel_checkout far "$nowhere"
expect 1 "last build is outside the clone and cannot be fetched" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=far VERCEL_GIT_PREVIOUS_SHA="$prev"
more apps/web/src/page.txt
vercel_checkout far "$bare"
expect 1 "last build is outside the clone, web changed since" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=far VERCEL_GIT_PREVIOUS_SHA="$prev"

vercel_checkout docs-only "$bare"
expect 1 "previous SHA that exists nowhere" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=docs-only VERCEL_GIT_PREVIOUS_SHA=0123456789abcdef0123456789abcdef01234567

vercel_checkout master "$bare"
expect 0 "production, docs only since the last build" VERCEL_ENV=production VERCEL_GIT_COMMIT_REF=master VERCEL_GIT_PREVIOUS_SHA="$(sha master~1)"

# ── production moved on: a docs-only branch cut BEFORE a web change ──────
# Its web tree is not what production built, so it is a real preview.
branch stale docs/readme.md
g checkout -q master
echo "newer" >> apps/web/src/page.txt
g add -A && g commit -q -m "master web change" && g push -q origin master
vercel_checkout stale "$bare"
expect 1 "first push, docs only, but production's web has moved on" VERCEL_ENV=preview VERCEL_GIT_COMMIT_REF=stale

echo
if [ "$fails" -ne 0 ]; then
  echo "$fails scenario(s) FAILED"
  exit 1
fi
echo "all scenarios passed"
exit 0
