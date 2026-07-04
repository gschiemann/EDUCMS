# Pre-launch adversarial bug-hunt (2026-07-03)

Four adversarial hunt waves on the live pre-launch pilot. Each candidate was found by an independent lens-scoped finder, then **refute-verified by 2 independent adversarial verifiers**; only double-CONFIRMED findings are recorded. **22 real bugs** confirmed total.

| Doc | Wave | Lenses | Confirmed |
|---|---|---|---|
| `00-CONFIRMED-BUGS.md` | 1 | 7-lens (money, realtime, sports, builder, POS, billing) | 6 |
| `01-HUNT2-BILLING-EMERGENCY.md` | 2 | 8-lens (isolation, RBAC, concurrency, await-500, realtime, money, SSRF, scale) | 4 |
| `03-HUNT3-FINDINGS.md` | 3 | 9-lens (device-auth, idempotency, cron, SW-cache, upload, web-races, deep-isolation, error-masking, scale) | 8 |
| `04-HUNT4-FINDINGS.md` | 4 | 6-lens (crypto/signing, session/cookie/CORS, rate-limit/DoS, business-invariants, encoding/injection, schema-drift) | 4 |
| **`05-DECISIONS-FOR-GREG.md`** | — | **consolidated handoff: 14 shipped + 8 blocked-on-decision** | — |
| `02-NEXT-SPRINT-PLAN.md` | — | resume/launchpad (fence, merge gate, infra sweep) | — |

**Start at `05-DECISIONS-FOR-GREG.md`** — it summarizes what shipped and what needs a human call (emergency / billing / schema / config).

Method notes: hunts run as background `Workflow` pipelines (parallel finders → per-finding 2× refute-verify → confirmed-only). Every fix was built by a fenced worktree agent, adversarially tested (test fails without the fix), gated (tsc + targeted jest + web toolchain + rule-#10), lead-reviewed per-commit, and CI-watched to green before the next.
