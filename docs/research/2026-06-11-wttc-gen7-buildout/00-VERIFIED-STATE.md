# Water polo + CTS — Fable 5 re-verified state + Gen7/WA-2 build plan (2026-06-11)

**Context:** First live customer runs water polo on a CTS **WTTC-1** → Goodview EP6N/ECBox → ribbon.
Greg's directives: build Gen7/WA-2 blind from reference + capture tooling · operator-proof setup ·
bulletproof manual path · best-in-industry UI. Timeline: a few weeks.

## Re-verified findings (code-traced on Fable 5, 2026-06-11)

### Solid (not costumes — verified)
- **Manual operator path**: game console (5,292-line page + 9 panels: CueLaunchpad, Roster, Ribbon,
  Sponsor, SurfaceHealthPills, RecentEvents, CtsCuePanel, SurfacePreview, RibbonImages) → HMAC
  game-feed token (`feedTokenVersion` revocation, sports-board.controller.ts:163) → board (2,608 ln) /
  ribbon (3,272 ln) / scorebug / overlay. Zero serial dependency. Cues fixed 06-04 (dynamic names,
  tap-cue→pick-player→fire; live-verified with screenshots).
- **CtsBridge.tsx (1,762 ln)**: Web Serial, profile-driven serial settings, query overrides
  (`ctsBaud` etc.), feed-credentials flow, CUE/SCORE POST mapping.
- **ECBox Phase 1** native serial bridge complete; Phase 2 = hardware checklist (cable batch, OEM
  image ask, on-arrival steps) awaiting the box.

### Defects (the serial DECODE layer — all confirmed)
1. **No Gen7/WA-2 decoder exists.** `cts-gen7` profile = Gen7's *RS-232 legacy output* only.
   The WTTC's SCBD ports are Gen7/WA-2 RS-485 — nothing decodes that stream.
2. **Legacy framing is wrong vs real hardware.** Reference classic decoder:
   `channel = ((byteIn >> 1) & 0x1f) ^ 0x1f` (coloradoScoreboard.js:172) — shifted+INVERTED.
   Our parser.ts assumes `module = byte & 0x7f` (and encodePacket emits `0x80|(module&0x7f)`).
   Self-consistent with our own emulator ONLY → never decoded a real console. (T2-1's "full
   fidelity" was validated against the simulator, i.e. self-licking.)
3. **Water-polo channel map contradicts F872.** Code: score=0x02/0x03, period=0x04, shot=0x06/0x07,
   excl=0x08-0x0d, TO=0x10/0x11. F872 Appendix B (System 6 water polo): clock=ch1,
   **period+shot packed by digit position on ch2**, ejects=ch4/3/11, score=ch5 (or packed line ch7:
   `HH 88:88 AA`), TO=ch12/6, scorer-recognition=ch13, fouls=ch14, per-cap fouls=ch15-21.
   Channels pack MULTIPLE fields by digit position; venues can remap via Define-Module.
4. **ECBox cable spec covers only ¼″ RS-232** — WTTC needs the RS-485 variant (below).

## Gen7/WA-2 protocol — fully extracted from MIT reference (fabriziobertocci/coloradoScoreboard)

- **Serial: 115200 baud, 8 data bits, NO parity, 1 stop** (legacy = 9600/8/EVEN/1). RS-485.
- **Scrambler**: XOR keystream. Address byte (>127) seeds: `mapper = MAPPINGS[byte & 31]`,
  `isOdd = byte % 2`. Next byte: `mapLength = byte ^ (mapper & 0x7F)`. Subsequent:
  `byte ^ (rot[L|R]32(mapper, mapLength * count) & 0x7F)` (rotate dir by isOdd). MAPPINGS = 32
  uint32s from a 256-hex-char constant (odd indices from first half, even from second).
- **Packet**: start byte (bit7) → length → payload → checksum = (sum incl. start+len) & 0x7F.
- **Inner "enhanced" stream**: module header byte (bit7; module = b & 31; 0x40=Univ, 0x20=Horn) →
  digit pairs [digit idx = b & 31, 0x40=DecPoint, 0x20=SegmentMapped] then [value byte; 0→space].
  Board model = 32 modules × 31 digits. Module 31 = command channel (cmd 18 = start-list/meet
  title UTF-8 with 0x7F high-bit escape). Nested double-remapped sub-packet: header 159 + (17|19) +
  pool# (multi-pool).
- **On open, reference writes init seq `[0x80, 0x1F, 15, 2]`** to the console.
- **Connector/cable (WTTC SCBD)**: Conxall/Switchcraft **3280-4PG-315** male plug + FTDI
  **USB-RS485-WE-1800-BT**. Pinout (female socket, from console back): Pin 2 = Data+ (orange),
  Pin 3 = Data− (yellow), Pin 4 = GND (black). Pin 1 unused. For EP6N RS-485 input: Pin 1 B− /
  Pin 2 A+ / Pin 11 GND (from 06-01 dig).
- **Real captured fixtures**: `samples/meet.bin|blank.bin|totalBlank.bin` (52-61k) — CLASSIC
  protocol captures (file-input is classic-mode); validate the corrected legacy decoder against
  them. Gen7 validation = scrambler round-trip + synthetic vectors until a WTTC capture.
- License: MIT (attribution in ported files).

## Build plan (this effort)
1. `packages/scoreboard-cts/src/gen7/` — scrambler + framer + module/digit grid (port w/ MIT
   attribution), emitting the same CtsFullSnapshot via the shared extractor (3).
2. Fix legacy framing to the real control-byte format; keep emulator pair updated (it must emit
   REAL format now); validate vs meet.bin/blank.bin fixtures.
3. **Shared water-polo field extractor**: grid (module→digit chars) → CtsFullSnapshot using an
   F872 channel map that is **configurable per profile + query override** (Define-Module reality).
   Used by both legacy + gen7 transports.
4. Profiles: `cts-wttc` → decoder 'cts-gen7wa2', 115200/8/N/1, RS-485 notes, stays provisional
   ("pending real capture"); `cts-gen6`/`cts-gen7` get the corrected framing + F872 map.
5. CtsBridge: gen7 decoder selection + **capture mode** (raw byte ring → downloadable hex dump)
   for venue bring-up; "Show Defs on SCBD" instructions.
6. Docs: WTTC RS-485 cable spec + CTS call script + ECBox checklist addendum.
7. Then: manual-path E2E re-verification + UI/visual phase.
