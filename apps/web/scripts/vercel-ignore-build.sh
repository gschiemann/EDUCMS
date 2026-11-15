#!/bin/sh
# Vercel "Ignored Build Step" for the web project (apps/web is the root
# directory; `vercel.json` points here). Exit 0 = SKIP the build, exit 1 =
# BUILD. Vercel treats ANY other exit code as a FAILED deployment (learned
# 2026-09-03: a `git diff` that hit a missing object exited 128 and failed
# five deployments in a row), so every path below ends in exactly 0 or 1.
#
# Skip only when a comparison base is known AND nothing the web build
# consumes changed since it. An unknown or unfetchable base means BUILD: a
# multi-commit push must never be judged by HEAD^ alone.
#
# 2026-11-15 (cost audit, docs/COST.md) - THE FIRST PUSH OF A BRANCH.
# `VERCEL_GIT_PREVIOUS_SHA` is empty on a branch's first deployment, and this
# script used to answer "empty = BUILD". Every new branch therefore paid for
# one full web build even when it touched only the API, the APK or docs -
# and Build CPU Minutes were the largest usage line on the 2026-11-14 invoice.
# A PREVIEW with no previous deployment is now compared with the tip of the
# production branch instead: a tree whose web inputs are identical to what
# production already built has nothing new to preview. Production itself, and
# every case where that tip cannot be fetched, still BUILDS.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
b="$VERCEL_GIT_PREVIOUS_SHA"
if [ -z "$b" ]; then
  [ "$VERCEL_ENV" = "preview" ] || exit 1
  [ "$VERCEL_GIT_COMMIT_REF" = "master" ] && exit 1
  git fetch --depth=1 origin master >/dev/null 2>&1 || exit 1
  b="$(git rev-parse --verify --quiet 'FETCH_HEAD^{commit}' 2>/dev/null)" || exit 1
  [ -z "$b" ] && exit 1
elif ! git cat-file -e "$b^{commit}" 2>/dev/null; then
  git fetch --depth=1 origin "$b" >/dev/null 2>&1 || exit 1
fi
if git diff --quiet "$b" HEAD -- apps/web packages pnpm-lock.yaml package.json turbo.json 2>/dev/null; then
  exit 0
fi
exit 1
