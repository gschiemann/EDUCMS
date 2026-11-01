# A client-IP pick that was too low (2026-07-07)

**Date:** 2026-07-07

## What happened

The `TRUSTED_PROXY_HOPS` row of `docs/ENVIRONMENT.md` records it as "the 2026-07-07 bug":

> Getting it wrong does not crash anything, it silently picks the wrong entry: **too HIGH** and you select an attacker-controlled position, so a client that sends its own `X-Forwarded-For` can rotate the throttle key at will (defeating every brute-force cap) and forge the audit IP; **too LOW** and you select a rotating internal hop, so the throttle key moves every request and rate limits never fire — the 2026-07-07 bug.

## Root cause

The configured number of trusted proxies was lower than the real chain, so the client IP was picked from a rotating internal hop: the throttle key moved every request and the per-IP rate limits never fired (the quoted sentence).

## The rule it produced

`docs/ENVIRONMENT.md` → `TRUSTED_PROXY_HOPS`: count trusted `X-Forwarded-For` appenders from the right; the default is the measured Railway chain; re-verify it whenever the Railway/CDN chain changes.

## Evidence

- `apps/api/src/security/client-ip.ts` picks the client IP.
