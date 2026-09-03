#!/bin/sh
# Vercel "Ignored Build Step" for the web project (apps/web is the root
# directory; `vercel.json` points here). Exit 0 = SKIP the build, exit 1 =
# BUILD. Vercel treats ANY other exit code as a FAILED deployment (learned
# 2026-09-03: a `git diff` that hit a missing object exited 128 and failed
# five deployments in a row), so every path below ends in exactly 0 or 1.
#
# Skip only when the previous production commit is known AND nothing the
# web build consumes changed since it. An unknown or unfetchable base means
# BUILD — a multi-commit push must never be judged by HEAD^ alone.
cd "$(git rev-parse --show-toplevel 2>/dev/null)" || exit 1
b="$VERCEL_GIT_PREVIOUS_SHA"
[ -z "$b" ] && exit 1
if ! git cat-file -e "$b^{commit}" 2>/dev/null; then
  git fetch --depth=1 origin "$b" >/dev/null 2>&1 || exit 1
fi
if git diff --quiet "$b" HEAD -- apps/web packages pnpm-lock.yaml package.json turbo.json 2>/dev/null; then
  exit 0
fi
exit 1
