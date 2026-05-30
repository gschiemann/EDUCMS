# §6 Streaming · §7 Sports-Data · §8 POS/Commerce

**Audit date:** 2026-05-30 · read-only, traced every clickable provider to real callers · current HEAD (newer than the 2026-05-28 synthesis). The honesty sweep `0ce9e04` + POS Phase-2/3 + sports editability landed AFTER the synthesis P0 list — **most of its costumes are FIXED**, re-verified here.

## 1. Coverage table

| § | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 6 | Streaming | B+ | B+ | **B** | Multi-protocol widget real (YT/Twitch/HLS/public broadcasters); NFHS/Hudl overlay NOW REAL; all 5 prior costumes de-costumed. Residual: RTSP/RTMP needs transcoder (honest), IPTV `.m3u` playlist parser absent (minor) |
| 7 | Sports-data | A− | B+ | **B+** | CTS Gen 6 gold-standard; generic `/feed` real + UI button wired; 19 SportDefinitions generically rendered; auto-celebration real; overlay real. Named vendors honestly COMING_SOON + hidden. RS485 costume FIXED |
| 8 | POS/commerce | B+ | B+ | **B** | Square production-grade; custom-webhook BYO-POS real (3 payload shapes); generic Custom-data (REST/JSON+Sheet CSV) NEW + hardened + wired. 6 PARTNER providers honestly gated + API-rejected. Live POS into 5 widgets |

**Net change since synthesis:** §8 F C→B, §7 F B→B+, §6 F C+→B. The "only ~3 of ~30 wired" framing is now stale on *costume-honesty* grounds — un-wired providers are honestly labeled + **rejected at the API boundary**, not costumes. Residual = breadth, not lies.

## 2. Findings

**Prior P0/P1 costumes — VERIFIED FIXED:** P0-5 custom-webhook 404 (live receiver `pos-oauth.controller.ts:323`, constant-time secret, 3 shapes, idempotent, tested); P0-6 Daktronics/Nevco RS485 dropdown (removed from live `RS485_OPTIONS`, disabled "coming soon"); traffic-cam fake-live widget ("Sample data" + SAMPLE badge); 60 TODO-URL FAST channels (deleted; 52 real HLS Pluto+Xumo); Vimeo over-promise (DIRECT→PARTNER); DASH `.mpd` silent-fail (honest "use HLS"); `copyFeedUrl` stranded button (now bound `sports/[gameId]/page.tsx:872`).

**Residual gaps (all LOW/honest — no costumes found):**
| Sev | § | Gap | file:line |
|---|---|---|---|
| LOW | 6 | RTSP/RTMP camera shows "requires server-side transcode" but no transcoder ships | `StreamingWidget.tsx:136-145` |
| LOW | 6 | IPTV `.m3u` multi-channel playlist unsupported (only single `.m3u8`) | StreamingWidget (no parser) |
| LOW | 6 | NFHS Network as a *managed integration* still N-A (the broadcast OVERLAY is built) | `discovery.service.ts:203` |
| LOW | 7 | Generic `/feed` JSON ingest real + wired but no operator docs for the JSON shape | `sports-board.controller.ts:172` |
| INFO | 7+8 | `data-source-rate-limiter.ts:33` + POS free-tier caps in-memory Map (per-replica) — Redis before horizontal scale | `data-source-rate-limiter.ts:33` |

No NEW costumes found in any of the three clusters.

## 3. Per-provider real-vs-costume verdict

**§7 Sports:** CTS Gen 6 console **WORKS** (gold standard); generic `/feed` **WORKS** (wired); auto-celebration **WORKS** (`sports.service.ts:2611+`); broadcast overlay **WORKS** (`/overlay/[gameId]`); 19 SportDefinitions **WORK** (declarative, generically rendered). Daktronics / Sportzcast / Genius / Sportradar / MaxPreps / GameChanger **NOT-BUILT** (honest COMING_SOON, hidden from operators). `ScoreSource` abstraction does not exist (only COMING_SOON copy; reality = CTS + `/feed`).

**§8 POS:** Square **WORKS** (OAuth + catalog poll + HMAC webhook + idempotency + audit + cron, consumed by widgets); Custom Webhook BYO-POS **WORKS**; generic Custom-data (REST/JSON + Sheet CSV) **WORKS** (new Phase 3, SSRF-gated, RBAC, double rate-limit, audit, wired into builder). Toast / Clover / Lightspeed / Shopify / Stripe-catalog / MINDBODY **NOT-BUILT** (honest PARTNER — rejected at API boundary `pos.service.ts:98`); Aloha **N-A** (honest CLOSED). Live POS-consuming widgets: MenuBoard, ComboCarousel, TapList, CocktailMenu, SpecialsCallout.

## 4. Biggest risk
The breadth gap is real but **no longer dishonest** — every un-wired vendor is correctly labeled COMING_SOON/PARTNER and rejected at the API boundary. Residual customer risk is the honest *absence* of named-vendor syncs (Toast/Clover/Daktronics), not a costume that fails after a click.
