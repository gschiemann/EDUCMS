# Resume Points — Player Security Program

## Wave 2 (in flight, 2026-08-02)
- **Workflow run id:** `wf_814aca52-f7b`
- **Script (also in this folder):** `wave2-audits-and-fixes.workflow.mjs`
- **Resume:** `Workflow({scriptPath: "<this folder>/wave2-audits-and-fixes.workflow.mjs", resumeFromRunId: "wf_814aca52-f7b"})`
  — completed agents return cached results instantly; only unfinished ones re-run.
- **Journal (survives process death):**
  `~/.claude/projects/-Users-gschiemann-Desktop-EDU-CMS/f562d8c9-1016-4521-80e1-492ff21d1223/subagents/workflows/wf_814aca52-f7b/journal.jsonl`
  Every completed agent's full return value is recorded there. **Read it before assuming work was
  lost** — on 2026-08-02 six loose background agents died with the parent process and their
  in-process state was unrecoverable. That is why this wave runs as a Workflow instead.

Covers: device-token auth, OTA server-side authz, multi-tenant isolation, account blast radius
(+ `apps/edge/`), plus two fixes — iframe sandbox/CSP/server-side spatial-nav shim, and the
CONTRIBUTOR live-content gate.

## Salvaged partial work
- Branch `worktree-agent-ad14c55bb9466c488`, commit `91607468` — a 178-line
  `apps/api/src/templates/zone-url-guard.ts` plus controller wiring, rescued from an agent that died
  mid-task. Handles control-character smuggling, scheme-relative `//host`, and preserves
  root-relative paths. No tests; live-bound gate not built. The wave-2 authz agent was told to build
  on it rather than restart.

## Standing constraints (do not regress these)
- **Remote-control navigation must keep working.** Sandboxing the WEBPAGE proxy iframe breaks
  `contentWindow.eval`, so the spatial-nav shim must move server-side into the proxy's HTML rewriter
  and talk over a hardened `postMessage` channel (fixed command enum, `event.source` identity check —
  a null-origin frame reports `origin === "null"`, so origin alone is not a check).
- **Nothing is pushed.** The repo is public and these commits describe live, unpatched
  vulnerabilities. Disclosure sequencing is the owner's call.
- **Android Kotlin is uncompiled** — no JDK on this machine. CI must build it before it ships.
- **AND-004's PIN gate sits on the wrong layer** and should be dropped: `page.tsx:6497-6550` shows
  unpair is server-first, so the native gate blocks nothing while disabling the operator's exit hatch.
