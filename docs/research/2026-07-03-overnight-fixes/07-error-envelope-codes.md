# #57 — stable error-envelope `code` sweep (2026-07-03)

Safe, additive-only hardening: give code-less thrown errors a stable SCREAMING_SNAKE
`code` so the frontend maps them to real messages instead of a generic 500.

Contract: apps/api/src/common/all-exceptions.filter.ts defaults `code` from status,
overridden by `resp.code ?? resp.error` on object payloads. Convention:
`throw new XException({ code:'X', message:'…' }, HttpStatus.Y)`. Codes inline (no shared
api-types enum exists — matched majority).

FIXED: 256 code-less throws across 17 operator-facing controllers (screens+gpio,
templates, playlists, assets+folders+groups, branding, billing+webhook, sports-board+
sports+sponsors, ai-key, users, auth, mfa, tenants). Codes grouped by domain (SCREEN_*,
TEMPLATE_*, ASSET_*, USER_*, TENANT_*, AI_KEY_*, …); reused existing codes, no dupes.

EMERGENCY EXCLUDED per CLAUDE.md (needs sign-off) — 25 code-less throws LISTED not
touched: emergency.controller.ts L286/295/298/303/311/382/1117/1124/1292;
screen-emergency.controller.ts L125/132/190/211/219/225/240/322/378/385/458/525/532/
541/549/558.
DEFERRED (lower-traffic, honest follow-up): 22 controllers, 105 combined code-less
throws (floor-plans, schedules, pos-oauth, fitness×2, license, submissions, panic-
content, proxy, sso, usb-export, devices, music, player-ota, analytics, health, imports,
clever, notifications, player-logs).

ZERO status/message changes — agent diffed the HttpStatus-token multiset + exception-
class multiset per file, identical before/after; messages only wrapped into {code,message}.
tsc clean (my files), 301 controller-spec tests pass. Commits 66802867, 5a9ddc2c,
16bed568, ad6baf90, 596b7ca8, 4f6f0b29. Lead re-gated before merge.
