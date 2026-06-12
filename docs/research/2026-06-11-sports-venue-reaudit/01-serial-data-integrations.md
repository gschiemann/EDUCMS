# Serial + Data Integrations — Sports Venue Re-Audit (2026-06-11)

**Auditor scope:** the first customer's wire — CTS WTTC-1 → (Goodview EP6N/ECBox) → LED ribbon.
Standard Audit Surface sections covered: **7 (sports data)** in full, **6 (streaming)** N-A
(assigned to the streaming auditor), **15 (Taurus)** sports slice, **19/20** lenses applied.
Dedup base: 2026-05-27 sports-research, 2026-05-29 tier1 + provenue-gap, 2026-06-01 WTTC,
2026-06-04 cues, 2026-06-11 `00-VERIFIED-STATE.md`. Items those docs already establish are
marked **verified** or **KNOWN-OPEN**, not re-reported.

**Method:** line-by-line diff of commit `0f075bcf`'s decode layer against the MIT reference at
`/tmp/coloradoScoreboard/src/{ctsScoreboardasync.js, coloradoScoreboard.js}`; ran the package
test suite (54/54 pass, 4 suites, incl. real console captures); read full render/POST paths in
`CtsBridge.tsx` (1,763 ln) + `sports-board.controller.ts` + `sports-feed-token.ts`; live curl
probes of the deployed feed endpoints (fake UUID, zero mutation).

**Bottom line:** the new decode layer is a faithful, test-validated port — the strongest serial
work in the repo to date. **No P0s.** The remaining risk is all in the seam: the new layer is
not wired (known/planned), the `stable` labels on cts-gen6/gen7 are now provably false
advertising, the WTTC RS-485 cable has no orderable spec in the install docs (lead-time risk),
and the unauthenticated `cts-cue-fired` endpoint pollutes sponsor proof-of-play.

---

## Coverage + grades table

| Area | Coverage | DESIGN | UX | FUNCTIONALITY |
|---|---|---|---|---|
| (a) New decode layer: gen7.ts / classic.ts / grid.ts | covered | A− | B− (JSON-only map override; no UI yet) | **classic A− (real-capture validated) · gen7 B (faithful port, unvalidated vs real WTTC — by design)** |
| (b) Old parser.ts/types.ts path + migration | covered | C (synthetic protocol, mislabeled `stable`) | B | D as a *real-console* decoder (admitted in classic.ts header); A as emulator/demo |
| (c) CtsBridge.tsx host readiness | covered | B+ | B (native auto-connect good; Web Serial manual; URL-param setup) | B+ today / **not gen7-ready without cadence API + capture mode** |
| (d) Daktronics path honesty | covered | A− | A− (amber "capture pending" chip + honest help text) | provisional-by-declaration (correct) |
| (e) ECBox Phase-2 checklist + cables vs WTTC RS-485 | covered | B | B+ (excellent RS-232 docs) | **D for the WTTC's actual wire — RS-485 spec missing from install docs** |
| (f) Feed endpoint security | covered (incl. live curl) | A− | B+ | A− (token path) / **C (cue-fired unauthenticated)** |
| 6 Streaming | **N-A — other auditor** | — | — | — |
| 15 Taurus sports slice | covered | A | A | A (bridge self-hides pre-Chrome-89; panel uses longhand styles, no `inset`/flex-`gap`) |

---

## (a) Adversarial verification of the new decode layer (commit 0f075bcf)

### gen7.ts vs `/tmp/coloradoScoreboard/src/ctsScoreboardasync.js` — line-by-line

**Scrambler — bit-for-bit parity. ✅**
- `MAPPING_HEX` identical (256 hex chars); `buildMappings()` (gen7.ts:67-76) reproduces the
  reference's odd/even split exactly: first half → odd indices `m[i*2+1]`, second half (offset
  128) → even indices `m[i*2]` (reference `_initMappings`, ctsScoreboardasync.js:243-257).
- Rotate dirs: even address (`isOdd=false`) → rotate-LEFT, odd → rotate-RIGHT
  (gen7.ts:107-109 vs reference :418-420). `rotL/rotR` mask `n & 31` exactly like the
  reference's `count &= 31`; the `& 0xFFFFFFFF` (ToInt32) vs `>>> 0` (ToUint32) difference is
  immaterial — identical low 5 bits feed the rotation. Edge case n≡0 (mod 32) yields `x` in
  both (JS shift-count masking).
- `mapLength` derivation: `src ^ (mapper & 0x7F)` on the first post-address byte
  (gen7.ts:103 vs reference :414); keystream `rot(mapper, mapLength·mappingCount) & 0x7F`,
  count incremented AFTER use — same ordering both sides (gen7.ts:107-110 vs :417-423).
- Address bytes (>127) pass through and reseed — identical (gen7.ts:96-100 vs :408-412).
- `scrambleByte` (no reference counterpart — our emulator addition) correctly derives the
  first keystream from the **plain** value (gen7.ts:127), the exact inverse of the
  descrambler's recovered value. Round-trip pinned in `real-wire.test.ts:101-120` across odd
  AND even seeds (rotate-direction divergence asserted).

**Packet framing — parity, incl. the two subtle bits the assignment flagged. ✅**
- *Start-byte-is-module-header:* the packet start byte (bit7) is stored in the buffer and fed
  through `parseEnhancedByte` along with the payload (gen7.ts:284, reference's drain loop
  :376-379 feeds `incomingData[readPtr]` which includes the header at index 0).
  `encodeGen7ModulePacket` documents and reproduces this (gen7.ts:330-357).
- *Checksum:* `(start + length + Σpayload) & 0x7F` compared to the trailing byte —
  gen7.ts:218 vs reference :352-353. Mid-packet resync on an unexpected high byte matches
  (:206-214 vs :342-348); the reference's `calculatedChecksum = src1` ("original source") in
  the outer-start branch is equivalent to ours (`= b`) because address bytes pass the
  descrambler unchanged.
- *Nested 159/(17|19) multi-pool sub-packet:* loop bounds verified equal — ours iterates
  `i ∈ [1, bufLen−4)` with `bufLen = expected+1`; reference `idx2 ∈ [1, dataCount−4)` with
  `dataCount = expected+1` at finalize. Inner checksum byte: ours `buf[bufLen−1]` ==
  reference `incomingData[readPtr + dataCount − 1]`. First inner byte re-ORed with 0x80, inner
  length byte summed-but-skipped (`if (i !== 1)`) — all identical (gen7.ts:258-283 vs
  :355-375). **Deliberate, documented divergence:** ours extracts pool 0 only; the reference
  feeds `ParseEnhancedByte(b, poolNumber)` for any pool but its `scbd` array has ONE entry, so
  a real multi-pool packet would throw (`this.scbd[1]` undefined) — our version is strictly
  safer.
- Double-start-byte edge (address byte arriving where length expected): both implementations
  mis-frame identically and recover via checksum reject — parity even in the failure mode.

**Enhanced-byte digit pairs — parity with two fidelity gaps. ⚠**
- Module header `b & 31`, horn flag 0x20, command channel 31 swallowed, digit-31 → command
  mode, value byte `0 → 32`, `15|32 → ' '` — all match (gen7.ts:287-325 vs reference
  :462-539 + `DataToChar` :635-638).
- **Divergence 1 — `Univ` (0x40) flag is read but not modeled** (gen7.ts:24 documents the bit;
  nothing stores it). The reference sets `BoardData[module].Univ` (:511) and its
  `GetTime`/`GetDigits` substitute **module 0's digits** when a module is flagged universal
  (:651, :672) — the "universal time" display mode. If the WTTC marks the water-polo clock
  module universal and streams the running clock only on module 0, our extractor shows a
  frozen/blank clock. Mitigable on-site by remapping `clock.channel → 0` (the map is
  configurable), but the decoder should model it. **P2.**
- **Divergence 2 — `SegmentMapped` (0x20 on the position byte) dropped** (gen7.ts:311 stores
  only decPoint; reference stores it :527 but also never alters value decode). Equal render
  fidelity to the reference; segment-bitmap values would be garbage on both. **P3.**
- Swimming-specific close-out logic (module 12 event/heat, module 15 reset-dots, module 31
  command parse for meet titles/start lists) deliberately not ported — documented
  (gen7.ts:27-31), water polo doesn't need it. Acceptable scope cut.
- The header claim "Gen7 module numbers == classic channel numbers" (gen7.ts:33-35) is an
  **assumption** with no capture to back it — correctly mitigated by the configurable map +
  `provisional` status. KNOWN-OPEN by design until the bring-up capture.

### classic.ts vs `coloradoScoreboard.js processByte()` (:168-209) — exact parity ✅

- Control byte: `readout = (b & 1) === 0`; `channel = ((b >> 1) & 0x1f) ^ 0x1f` (the
  shifted+INVERTED format the 00-VERIFIED-STATE doc demanded) — classic.ts:69-70 vs :171-172.
- Blank-line command `b > 0xBE` (190) — classic.ts:76 vs :177.
- Data byte: position = high nibble, guard ≥8; char = `nibble ^ 63` — the reference writes
  `segmentData ^ 0x0f + 48` which by JS precedence is `^ (0x0f+48)` = `^ 63`; ours matches the
  *computed* semantics, not the misleading source text. Nibble-0 → blank **only when
  channel > 0** (channel 0 keeps `'?'`) — classic.ts:97 vs :198-203. Exact.
- The unreachable `channel > 31` warning branch (classic.ts:71) is dead code (5-bit XOR can't
  exceed 31) — harmless; in the reference the equivalent check is live because its display
  array can be shorter. **P3 (cosmetic).**
- `encodeClassicLine` round-trips through the decoder and documents that `'.'` never rides the
  classic wire — emulator now emits REAL framing (plan item 2 delivered at package level).

### Tests — run, not assumed ✅

`pnpm --filter @cms/scoreboard-cts test` → **4 suites, 54/54 pass** (~6 s). The load-bearing
suite is `real-wire.test.ts` against **real console captures** committed as fixtures
(`__tests__/fixtures/meet.bin` 61 KB, `blank.bin` 52 KB, `totalBlank.bin` 18 KB): coherent
display image (>95 % plausible chars), swim run-time digits on channel 0, blank-capture
blankness, encode↔decode round-trips, gen7 scramble↔descramble + framing accept/reject +
F872 end-to-end extraction. This kills the prior "self-licking simulator" failure mode for the
classic path. Gen7 remains synthetic-vector-only — **honestly documented** in the test header
(real-wire.test.ts:11-13) and gated `provisional`.

- **P3 (doc):** classic.ts:10 cites `__tests__/classic-real.test.ts` — that file doesn't
  exist; the tests live in `real-wire.test.ts`. Stale pointer.

### F872_WATER_POLO_MAP defaults (grid.ts:124-139) vs the 06-01 findings

Cross-checked against `docs/research/2026-06-01-wttc-water-polo/01-wttc-integration-findings.md`
(the F872 Appendix B table):

| Field | 06-01 research | grid.ts default | Verdict |
|---|---|---|---|
| clock | ch1 `88:88.88` | ch1, 0..8 | ✅ |
| period + shot packed | ch2 `8` + `:88.88` | period ch2 d0; shotPacked ch2 d1..5 | ✅ |
| shot standalone | ch9 `:88.88` | ch9, 0..6 (preferred when live) | ✅ |
| score | ch5 home `88` away `88` | ch5 0..2 / 2..4 | ✅ |
| ejects | ch4 / ch3 / ch11 | ch4/3/11, sides `unknown` until capture | ✅ honest |
| timeouts | ch12 / ch6 | home 12 / away 6 | ✅ (side assignment = capture item) |
| packed combo | ch7 `88 88:88 88` (HOME · CLOCK · AWAY) | homeStart 0·2, **awayStart 6·2** | ⚠ **likely misread** |
| scorers ch13 / fouls ch14 / per-cap 15-20 | documented | not extracted | scope cut, fine |

**The packedLine away slice looks wrong.** For `88 88:88 88` with the clock colon rendered by
decimal-point flags (how CTS boards do it — cf. reference `GetTime` inserting `':'` from
`DecPointLit`, not a cell), the cell layout is `H,H,␣,8,8,8,8,␣,A,A` → away digits at
positions **8-9**, not 6-7. As shipped, when ch5 is idle and the fallback engages, "away
score" reads the clock's last two digits. Low blast radius (fallback-only, config-overridable,
capture reconciles) but it's a wrong default on the documented layout. **P2** — and add it to
the bring-up capture checklist explicitly. Also the literal carries a stray `start: 0`
property silenced with `as any` (grid.ts:131) — fix the type instead. **P3.**

Extractor semantics otherwise sound: last-known-value persistence for idle channels (no
flicker-to-zero), single possession clock mirrored to both shot-clock fields, eject idle-line
suppression, cadence-inferred shot `running` — all tested.

---

## (b) The OLD parser.ts/types.ts CTS_MODULE path — consumers + cutover

The old protocol (`0x80|module` header + positional 7-seg bytes; `CTS_MODULE` semantic
addresses `0x01..0x1f`, types.ts:158-174) is **self-invented** — wrong framing AND wrong
channel numbers vs F872 (clock 0x01 is the only accidental match; HORN 0x1f collides with
Gen7's command channel). classic.ts:4-10 now admits this in writing.

**Live consumers (exhaustive grep):**

| Consumer | What it uses | Breaks at cutover? |
|---|---|---|
| `CtsBridge.tsx:551,635-636` | `new CtsParser()` + `.feed()` | YES — swap to profile-selected decoder |
| `CtsBridge.tsx:872-899` | `parser.getLastClockPacketAt()` / `getClockPacketIntervalMs()` (clockRunning cadence) | **YES — new decoders don't expose these** |
| `CtsBridge.tsx:1371-1403` sim button | `MockCtsFeed` + `REHEARSAL_SCRIPT` + `scriptGame` | YES — mock emits OLD framing; fed to ClassicCtsDecoder it is correctly rejected → "Play sample game" goes dead |
| `packages/.../mock.ts` | `encodePacket` + `CTS_MODULE` throughout | YES — re-emit via `encodeClassicLine` (exists) keeping script semantics |
| `packages/.../__tests__/parser.test.ts` | old parser directly | retire/repoint |
| `apps/web/src/app/super/cts-simulator/page.tsx` | **server-side** sim via `useCtsSimulator` hook — snapshot-level, NOT wire bytes | NO (verified imports: page.tsx:23-30) |
| `cts-fields.ts:24`, `WiringPanel.tsx:161` | comments only | doc updates |
| Widgets / board / ribbon / scorebug / `sports-board` ingest | `CtsFullSnapshot` shape only | NO — grid extractor emits the same shape (the rebuild's key design win) |

**Migration order (lowest-risk):**
1. Add a cadence API to the new layer (clock-packet timestamps on `ClassicCtsDecoder`/
   `Gen7Parser`, or derive in the extractor from `receivedAt` deltas) — unblocks
   `clockRunning` before anything else moves.
2. Extend `ConsoleDecoder` → `'cts-classic' | 'cts-gen7wa2' | 'daktronics'` (alias `'cts'` →
   classic); flip `cts-wttc` to gen7wa2 @ **115200/8/N/1** + `GEN7_INIT_SEQUENCE` write-on-open
   (the bridge currently never writes to the port — the reference's `[0x80,0x1F,15,2]` open
   handshake needs a TX path in both Web Serial and the native APK bridge); add
   `waterPoloMap` override to the profile + `?ctsMap=` query.
3. CtsBridge: instantiate by `profile.decoder`; port the sim button to `encodeClassicLine`.
4. Re-point mock.ts/REHEARSAL_SCRIPT to real framing; retire parser.ts + parser.test.ts last.

**Finding (beyond the verified-state doc): the `stable` labels are now falsehoods.**
`cts-gen6`/`cts-gen7` ship `status: 'stable'` (console-profiles.ts:122,139) — defined as
"decoder matches the documented protocol" — while the only wired decoder is the synthetic one
that provably cannot decode the real captures (real-wire.test.ts:6-9: "could not decode a
single byte of them"). Until the cutover lands, those two profiles must read `provisional`
too, or the cutover must land first. **P1 (ships a falsehood in the operator picker).**

---

## (c) CtsBridge.tsx — ready to host gen7 + capture mode?

**What's solid (verified in code):**
- Profile resolution: prop > `?consoleProfile=` > default, unknown ids fall back safely
  (CtsBridge.tsx:401-406, resolveConsoleProfile). Serial settings flow profile → ref →
  `readSerialOptsFromQuery` with per-field `ctsBaud/ctsDataBits/ctsStopBits/ctsParity`
  overrides (:311-332) — gen7's 115200/8/N/1 will ride the same rails once the profile flips.
- Native tty selection from profile (`/dev/ttyUSB0` for usb-serial) + `?ctsTty=` override
  (:735-737); dual-port wiring with per-port roles + per-port line accumulators.
- POSTs: latest-wins 200 ms throttle (:204, :996-1013); gameId+feedToken → persistent
  `POST /sports/board/:id/cts-snapshot` with `x-feed-token`; legacy device-token screen
  broadcast otherwise; full T2-1 payload (per-side shot clocks, 3-slot exclusions with
  explicit nulls to clear stale data, timeouts) (:911-951). CUE/SCORE Stream-Deck dispatch
  hits the same game endpoints with the feed token (:572-614).
- Simulator feeds the SAME parser instance, so the entire downstream path is rehearsable
  without hardware (:1371-1403). Taurus-safe by absence (Web Serial gate hides it pre-89).

**Gaps for hosting gen7 + bring-up:**
1. **No capture mode** — zero matches for "capture" in the file. The `aux` role logs 32-byte
   heads to console only (:651-661). The plan's promotion artifact (raw ring buffer →
   downloadable hex dump) doesn't exist yet. KNOWN-OPEN (plan item 5) but it's the single
   gating artifact for the WTTC — **build before the venue visit. P1 (planned).**
2. **clockRunning cadence is welded to the old parser's methods** (:891-892) — see migration
   step 1. **P2.**
3. **No TX path** — gen7 needs the init sequence written on open; neither the Web Serial path
   (`port.readable` only) nor the native bridge interface (`ctsSerialConnect/Disconnect/Status`
   — no write method) can transmit. **P2 (gen7 prerequisite).**
4. **Web Serial path has no auto-reconnect** — the header (:26-27) claims reconnect is
   mandatory, but the disconnect listener only flips status; nothing re-attaches (no
   `navigator.serial` 'connect' listener, mount-once effect :1269-1293). Native path does
   auto-reconnect (5 s poll + flat 2 s retry, backoff/caps deferred to Phase 3 — also restated
   in ECBOX3576_PHASE2_CHECKLIST.md:136). First customer is native → **P2**, but fix before
   any Beelink/Web-Serial deploy.
5. Error UX: one shared `error` slot — port-2 / native-bytes errors overwrite port-1's; no
   provisional/"capture pending" warning on the kiosk panel itself (badge only lives in the
   dashboard picker). **P3.**
6. Bridge only mounts with `?cts=1` and takes `?game=`/`?feedToken=` from the URL
   (player/page.tsx:7193-7202). Functional, and `?token=` is an accepted server-side pattern,
   but tokens-in-URLs leak into logs/history and hand-building URLs is the opposite of the
   operator-proof goal — manifest-carried game binding is the right end state. **P3.**

**Verdict:** the chassis is genuinely good — profile-driven, role-routed, throttled, dual
destination. It is **not yet** gen7-capable for the four reasons above; all four are
contained, mechanical changes.

---

## (d) Daktronics path honesty — verified ✅

The 06-09 honesty re-tier is real and operator-visible:
- `console-profiles.ts:156-171` — `status: 'provisional'` + notes naming the unconfirmed
  playClock/possession offsets and the capture requirement, with the audit rationale inline.
- Dashboard picker renders the amber **"capture pending"** chip + the honest help line for
  BOTH `daktronics-allsport` and `cts-wttc` (screens/page.tsx:606-607, badge at :734-738).
- The decoder package (`src/daktronics/{parser,offsets,mock,types}.ts`) has its own passing
  suite; the bridge instantiates it only when selected and maps to the same POST body with
  `source: 'daktronics'` provenance (CtsBridge.tsx:1036-1144).
No costume found; the provisional framing matches the same evidence bar the WTTC uses. Only
nit: the kiosk-side bridge panel shows no provisional hint (covered in (c)-5).

---

## (e) ECBox Phase-2 checklist + cable specs vs the WTTC RS-485 reality

**What exists (good, but for the WRONG wire for this customer):**
- `docs/ECBOX3576_PHASE2_CHECKLIST.md` — thorough bring-up list (cable batch with Mouser
  part numbers, OEM 0666-image ask, verify script, device-owner, tty identification, E2E
  smoke, per-box install profiles, failure table). All **¼″ RS-232 → 2-pin Phoenix**.
- `docs/EP6N_CTS_CABLE.md` — excellent Gen-6 RS-232 one-pager + a 2026-06-01 WTTC variant
  section… which documents only the **USB-B → FTDI USB-RS-232** path (CTS's "to a computer"
  port) and says "capture before the event."

**What's missing — the customer's actual wire (KNOWN-OPEN, verified still open):** the WTTC
**SCBD** ports are Gen7/WA-2 **RS-485**. The parts + pinout exist only in research docs
(00-VERIFIED-STATE.md:49-52, 06-01 findings §4.3), not in any install doc an installer would
follow:
- Console side: **Conxall/Switchcraft 3280-4PG-315** male plug; socket pinout (from console
  rear): **Pin 2 = Data+ (orange), Pin 3 = Data− (yellow), Pin 4 = GND (black)**, Pin 1
  unused — matches the reference repo's header comment (ctsScoreboardasync.js:6-25) verbatim,
  so the source is sound.
- Reader side: **FTDI USB-RS485-WE-1800-BT** → EP6N USB host (`/dev/ttyUSB0`), or directly
  into the EP6N's native RS-485 Phoenix pins (**1 = B−, 2 = A+, 11 = GND** per
  EP6N_CTS_CABLE.md's pin map — consistent with the 06-01 dig; note polarity: console Data+ →
  A+, Data− → B−).
- Serial params for that port: **115200 / 8 / N / 1** — the current `cts-wttc` profile still
  says 9600/8/E/1 (correct for the USB-B legacy path, wrong for SCBD; the profile split is
  migration step 2).

**P1:** write the RS-485 addendum (parts list + pinout + which EP6N input + the
115200/8/N/1 note + "Show Defs on SCBD" step) into EP6N_CTS_CABLE.md / the Phase-2 checklist
NOW — the Conxall plug and FTDI RS-485 cable are order-ahead items with real lead time, and
the checklist's whole premise is "order the cable batch before the box lands."

Also stale: checklist troubleshooting suggests `?ctsBaud=19200`/`?ctsParity=odd` for "wrong
scores" — for the WTTC SCBD the first question is 115200/8/N/1 + gen7 decoder, worth a line.

**Safety net re-verified:** both docs repeat that the manual operator path runs with zero
serial — the event is not gated on any of this. Consistent with 00-VERIFIED-STATE.

---

## (f) Feed endpoint security (sports-board.controller.ts) — traced to callers + live-probed

**Token verify — solid (sports-feed-token.ts):**
- Game-scoped HMAC-SHA256 truncated to 128 bits; **constant-time** compare via
  `crypto.timingSafeEqual` (:93-102); structured tokens bind version+iat+ttl INSIDE the MAC
  with a distinct `feedv:` prefix (no cross-shape replay); bare legacy tokens verify only at
  version 0; bumping `Game.feedTokenVersion` revokes everything outstanding
  (controller reads the live version per request, :167, :211). Secret = dedicated
  `SPORTS_FEED_SECRET` else boot-validated `DEVICE_SECRET_KEY` — no NODE_ENV-ungated literal.
- Rate-limit **before** auth, version read **after** the rate gate (anti-DB-hammer ordering,
  :149-160, :193-202). 40/10 s sliding window per game per endpoint family.
- **Live probes (fake UUID, no mutation):** `/feed` no-token → **401**; `/cts-snapshot`
  no-token → **401** `{"code":"UNAUTHORIZED"}`. Gates are real in prod.

**Findings:**
1. **`POST :id/cts-cue-fired` is unauthenticated — live probe returned 201.** The
   justification comment (:56-63) assumes only the kiosk knows the game id, but the game id is
   in every PUBLIC board/scorebug URL (`GET board/:id` is deliberately unguarded). Anyone who
   has seen a shared board link can write forged cue rows — up to 40/10 s ≈ 14 k/hr — into
   GameEvent, which feeds the **sponsor proof-of-play report** (":53-54: drives the sponsor
   proof-of-impressions"), i.e. revenue-adjacent data. Fix: require the feed token (the kiosk
   already holds it in gameId mode) or mark token-less rows `unverified` and exclude them from
   sponsor reports. **P2.**
2. Replay: tokens are long-lived bearer credentials by design (ttl supported but feed
   credentials are minted non-expiring); a replayed snapshot only rewrites transient
   `stats.cts` state and never touches operator columns (:117-121) — acceptable. The
   per-game rate map is **in-memory** (per-replica; fine at 1 replica, flagged class per
   CLAUDE.md multi-replica rule) and **entries are never evicted** — unbounded growth across
   distinct game ids. **P3.**
3. Query-string token (`?token=`) accepted by design for URL-only boxes — log-leak surface,
   documented tradeoff; keep header-preferred guidance. P3 (noted, not re-litigated).

---

## Consolidated findings

| # | Sev | Finding | Where |
|---|---|---|---|
| 1 | P1 | `cts-gen6`/`cts-gen7` still labeled `stable` while their only wired decoder provably never decoded a real console (new classic.ts is unwired) — operator-facing falsehood until cutover | console-profiles.ts:122,139 vs real-wire.test.ts:6-9 |
| 2 | P1 | WTTC SCBD **RS-485 cable spec absent from install docs** (Conxall 3280-4PG-315 + FTDI USB-RS485-WE-1800-BT, pins 2/3/4; EP6N 1/2/11) — order-ahead hardware, lead-time risk | EP6N_CTS_CABLE.md:197-226, ECBOX3576_PHASE2_CHECKLIST.md:9-30 |
| 3 | P1 (planned) | KNOWN-OPEN: capture mode not built — the artifact that promotes `provisional` and reconciles the channel map | CtsBridge.tsx (no capture refs) |
| 4 | P2 | Gen7 decoder ignores the `Univ` (0x40) module flag — reference substitutes module-0 digits; frozen clock risk if WTTC uses universal-time mode | gen7.ts:294 vs ctsScoreboardasync.js:511,651 |
| 5 | P2 | F872 `packedLine` fallback `awayStart: 6` reads the CLOCK digits on the documented `88 88:88 88` layout (away ≈ 8-9) | grid.ts:131 vs 06-01 findings table |
| 6 | P2 | `cts-cue-fired` unauthenticated (live 201) — forged cue rows pollute sponsor proof-of-play via public game id | sports-board.controller.ts:65-101 + live curl |
| 7 | P2 | clockRunning cadence welded to old `CtsParser` methods — new decoders lack the API; cutover compile-breaks the bridge | CtsBridge.tsx:891-892 |
| 8 | P2 | No serial TX path (Web Serial or native) — gen7 `GEN7_INIT_SEQUENCE` can't be sent on open | CtsBridge.tsx:78-92,112-138; gen7.ts:57 |
| 9 | P2 | Web Serial path: no auto-reconnect despite header claim; native = flat 2 s retry, no backoff/cap (Phase 3) | CtsBridge.tsx:26-27,1236-1247,816-829 |
| 10 | P3 | Sim button + mock.ts still emit the OLD synthetic framing — goes dead at cutover unless re-pointed at `encodeClassicLine` | mock.ts:19-38; CtsBridge.tsx:1378 |
| 11 | P3 | `SegmentMapped` digit flag dropped (parity-with-reference render fidelity, neither decodes bitmaps) | gen7.ts:311 |
| 12 | P3 | classic.ts cites nonexistent `__tests__/classic-real.test.ts`; unreachable channel>31 branch | classic.ts:10,71-75 |
| 13 | P3 | `packedLine` literal has stray `start: 0` + `as any` cast | grid.ts:131 |
| 14 | P3 | feedHits rate-limit map: per-replica + never-evicted keys; kiosk panel lacks provisional hint; shared error slot across ports; `?feedToken=` in player URL | sports-board.controller.ts:33; CtsBridge.tsx; player/page.tsx:7199 |

## What's solid (verified, not vibes)

- **classic.ts = exact reference parity** (incl. the `^ 0x0f + 48` precedence quirk ≡ `^63`,
  `>0xBE` blank, channel>0 nibble-0 rule) **and validated against three real console
  captures**; 54/54 package tests pass locally.
- **gen7 scrambler/framing = bit-for-bit reference parity** everywhere it matters: mappings
  split, rotate directions, mapLength derivation, checksum, start-byte-as-module-header,
  nested 159/(17|19) bounds — plus a deliberate safety improvement (pool-0 scoping where the
  reference would crash multi-pool).
- `scrambleByte` is a correct inverse (keystream from plain value), round-trip pinned across
  odd/even seeds.
- Grid/extractor architecture (display-image + configurable F872 map shared by both
  transports) is exactly the right answer to the Define-Module reality; last-known-value
  persistence prevents idle-channel flicker.
- Feed-token security: constant-time, versioned revocation, prefix-separated MACs, rate-limit
  ordering — and the 401 gates verified live.
- Provisional honesty shipped end-to-end for WTTC + Daktronics (registry + dashboard badge +
  cable doc warnings), and the manual operator path's independence from serial is restated in
  every doc that matters.

## Missing features (competitive/operational)

- CtsBridge capture mode (ring buffer → downloadable hex) — the promotion artifact.
- Gen7 decoder selection + 115200/8/N/1 `cts-wttc` profile + init-sequence TX.
- Cadence (clockRunning) API on the new decoders.
- WTTC RS-485 cable one-pager (orderable parts list) + checklist addendum.
- Channel-map override UI (JSON/query-only today) + "Show Defs on SCBD" guided step.
- On-kiosk provisional/capture-pending warning.
- Daktronics sample-game script (noted in code as future).

## Scoped down

Streaming (§6) deferred to the streaming auditor. Postgres MCP not used (no live-data question
in this lane). Live probing limited to the three feed endpoints with a fake UUID (hard rule:
no mutation of live data).
