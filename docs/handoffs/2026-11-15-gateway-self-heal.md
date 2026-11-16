# The way back from the gateway - 2026-11-15

Stacked on #311 (`claude/player-push-channel-direct`). Life-safety CHANGE class: this moves the origin the player's HTTP control plane uses, and the manifest poll on that plane is the alert backstop. Unmerged; needs a different-vendor review, the owner's written go and an on-glass drill.

Why it exists: the cost audit of the same date (`docs/handoffs/2026-11-15-cost-audit.md` on `claude/cost-guardrails`). In short: 27% of all screen traffic was reaching the API through the same-origin gateway on Vercel, 15.5 M requests in one billing cycle, and Vercel moved the team to a $100 tier by itself.

## What was wrong

`apiOrigin.ts` moves the whole control plane to the page origin after three consecutive network-class failures and never moves it back in the same session. The choice is persisted; the next boot tries direct once, and one failure (threshold 1) returns the screen to the gateway for that whole session too. So the only way back was a single request, made at the moment a box's network is least likely to be ready.

#311 makes the WebSocket dial the direct origin always. With #311 alone a gateway screen gets its push channel back, and still sends every poll through Vercel: about 20,400 requests a day per screen.

## What this changes

An authenticated, talking WebSocket on the direct origin is independent proof that direct is reachable: TLS, DNS, routing and the device credential. The socket supervisor (the existing 10 s tick, no new timer) offers that proof to the policy; `onDirectOriginProven` decides.

- **A probe, not a verdict.** The mode returns to `direct` with the persisted suspicion still set. That is exactly the state a boot starts in: one failed direct request sends the control plane back to the gateway, one success clears the suspicion (both through code that already existed).
- **Dwell.** No return until the session has been on the gateway for 5 minutes (`MIN_GATEWAY_DWELL_MS`), on the monotonic clock.
- **Failed-heal budget.** A return followed by a fallback before any direct request succeeded counts against the device. After two (`MAX_FAILED_HEALS_PER_SESSION`) the gateway is final for the session, which is the behaviour before this change. A return that was proven never counts, so a screen is not penalised for a day with many API restarts.
- **Unchanged:** when the plane leaves direct, what counts as a network-class failure, and the rule that no HTTP outcome on the gateway moves the mode. The existing test "never flaps back to direct mid-session" still passes untouched.

## Risk, stated plainly

- While a return is being proven, direct HTTP could fail. The cost is one poll (bounded by its own deadline), after which the plane is back on the gateway. During that window the push channel is authenticated by construction: it is the proof. The alert path is not without both legs at any point this change introduces.
- A network that carries the socket and not HTTP to the same host would flap twice and then stay on the gateway. Unit-tested; not reproduced on hardware.
- A screen whose network blocks WebSockets never produces the proof and behaves exactly as today (the boot probe is its only way back). That is a known limit, not a regression. A direct HTTP probe would cover it and adds a request; left for a decision.
- The units the gateway exists for (direct unreachable) never authenticate a direct socket, so nothing changes for them.

## Validation

- `apiOrigin.test.ts`: 39 tests, 19 new. The policy (dwell, probe semantics, budget, a device the proof is right about through 25 outages, a state without a clock, a non-finite clock), `pushProvesDirect`, and four source-text wiring guards. Three of the four fail against `page.tsx` without this change (run and confirmed); the fourth is #311's property.
- `apiOrigin`, `sseRecovery`, `pushGate`, `wsSupervisor`: 84 of 84 pass. Web `tsc --noEmit`: 0 errors. ESLint: clean on the policy and its test; no finding on or beside the edited lines of `page.tsx`.
- **Unverified:** a production build, the e2e suites (`api-origin-gateway.spec.ts`, `emergency-path.spec.ts`), and everything on glass.

## Bench plan (the owner approves each alert test)

1. Bench screen on this bundle. `window.__eduApiOrigin.mode` is `direct`.
2. Block the API host at the router for about 40 seconds. `mode` becomes `gateway`. Unblock.
3. Within a minute `window.__eduRealtime.state().authOk` is `true` (#311).
4. Five minutes after step 2 the console prints "control plane returning to direct"; `__eduApiOrigin` reads `mode: 'direct', healUnproven: true`, then `persistedFallback: false` after the next poll. In Vercel Observability that screen's `/api/v1/*` requests stop.
5. With the owner's approval for each: a drill while on the gateway with push up, one within seconds of the return, one after it. Paint proof inside the contracted latency each time.
6. Repeat step 2 while the box boots, to reproduce the boot race, and confirm the screen is back on direct about five minutes later instead of the next night.

## Rollback

Revert the pull request. No schema, environment or API change. The persisted key and its meaning are unchanged, so a reverted bundle reads every stored state correctly.

Models: builder Claude Fable 5.2 (Anthropic), Claude Code on the web. Reviewer: pending, a different vendor.
