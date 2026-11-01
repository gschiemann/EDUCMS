# Alpine native build failures (2026-04-19)

**Date:** 2026-04-19

## What happened

The rulebook recorded it in one sentence and lists five build failure modes the CI catches:

> They detect the build failures we hit in production debugging on 2026-04-19.

> **argon2 fails to native-compile on Alpine** (`bcrypt`, which did too, is no longer a dependency). The Dockerfile builder stage is `node:22.23.4-alpine` (pinned by digest in `ARG NODE_IMAGE`), which ships without a C/C++ toolchain. Without `apk add python3 make g++ openssl libc6-compat` before `pnpm install`, the package fails its `node-gyp` build with a cryptic `ELIFECYCLE` and Railway shows "Application failed to respond." → Caught by the **`docker-build`** job which runs the same image Railway will run.

## Root cause

Native modules need a C/C++ toolchain that the Alpine builder image does not ship, and a failed `node-gyp` build surfaces only as a cryptic `ELIFECYCLE` while Railway reports "Application failed to respond." (the quoted failure mode). The other four failure modes in the rule are a schema that was not on disk at install time, workspace TypeScript packages that were not built, lockfile drift, and TypeScript errors in `apps/web`.

## The rule it produced

`docs/DEPLOY.md` → "Deploy Reliability — CI gates" → "Build failure modes we've seen, and how the CI catches them" (each mode names the job that catches it) and "What never to do".

## Evidence

- The five failure modes, in full, are in `docs/DEPLOY.md`.
- `.github/workflows/deploy-reliability.yml` runs the jobs that catch them.
