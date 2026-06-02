# Water Polo Install — CTS **WTTC-1 Wireless Tabletop Controller** integration findings

**Date:** 2026-06-01 · **Status: pre-live-test deep dig (no real WTTC bytes captured yet).**
**Context:** The water-polo pilot customer will run the event on a **Colorado Time Systems
Wireless Tabletop Controller (WTTC-1)**, into our **Goodview EP6N** media player → ribbon.

## ⚠️ HEADLINE — the dig changed the picture. Read this first.

Our `@cms/scoreboard-cts` parser decodes the **legacy CTS RS-232 ("CTS") protocol**
(System 6 / Gen 6). Multiple sources indicate the **WTTC is a Gen7/WA-2-generation device**,
and **that protocol is "much different than the previous CTS RS-232 data streams."** So the
most likely reality is:

> **The WTTC emits the Gen7/WA-2 (RS-485) protocol, which our current parser does NOT decode.**

This is a *protocol-generation mismatch*, not a cable nit — and it's exactly the failure we'd
have hit cold at the live test. It is **fixable** (the Gen7/WA-2 format is documented + has an
open-source reference), but it is **net-new parser work**, not "plug in the existing cable."

**Confidence:** HIGH that legacy-RS-232 ≠ Gen7/WA-2 and that the WTTC is WA-2/WA-3 generation.
MEDIUM-HIGH that the WTTC's wired SCBD ports therefore emit Gen7/WA-2 over RS-485 (strong
inference from the device generation + connector style; **not yet confirmed against real bytes**).

---

## 1. Physical ports — CONFIRMED from the WTTC manual diagram (F1071, p6)

Back panel, left→right: **Power switch · SCBD 1 · SCBD 2 · ANT (2.4 GHz antenna) ·
RSR 1 (Run/Stop) · RSR 2 (Reset) · USB 1 · USB 2.**

- **SCBD 1 / SCBD 2** = the two wired scoreboard-data outputs. They are **round, threaded,
  multi-pin panel connectors** — **NOT** the System 6's ¼″ phone jack, and **NOT** a bare
  Phoenix terminal. This is a CTS circular data connector (consistent with their **RS-485
  4-pin "data jack"** family).
- **USB-B #2** → optional **DisplayLink Plus** computer feed to a video board (CTS's own paid
  software; carries per-cap stats + penalty-shootout). **Not our path** — we read the SCBD
  data port, not DL+.
- **RSR 1/2** = Run-Stop-Reset switch inputs (not data taps). **ANT** = wireless to the board.

**Cable impact:** our existing `EP6N_CTS_CABLE.md` cable (¼″ mono → EP6N Pin 3/Pin 11) **does
NOT fit the WTTC.** The WTTC end is a round SCBD connector; if the link is RS-485 we land on the
EP6N's **RS-485 pins (Pin 1 B- / Pin 2 A+ / Pin 11 GND)**, not the RS-232 pin. We need the SCBD
connector's part number + pinout (from CTS or the WTTC install/hardware doc) to build it — or a
CTS scoreboard data cable that mates with SCBD, adapted to the EP6N at the far end.

## 2. Protocol generation — the real risk

- CTS has **two scoreboard-output families**: **RS-232 (±12 V, "CTS" protocol)** [legacy:
  System 6/Gen 6 — what our parser handles] and **RS-485 (differential 3 V, "Gen7/WA-2"
  protocol)** [newer]. The two byte streams are *fundamentally different*.
- The **WTTC works with the WA-2 / WA-3 2.4 GHz wireless adapters**, and "WA-2" *is* the Gen7
  RS-485 protocol name → the WTTC is of the **Gen7/WA-2 generation**.
- ⇒ **Expect the WTTC SCBD output to be Gen7/WA-2 (RS-485), not legacy RS-232.** Our
  `CtsParser` (7-segment, address-byte legacy format) will **not** decode it as-is.
- **Good news:** the `fabriziobertocci/coloradoScoreboard` reference explicitly supports BOTH
  "legacy CTS (Gen6 and earlier)" **and** "Gen7/WA-2 (Gen7 Serial)" — so the Gen7 format is
  decodable; we have a reference to build/validate a `CtsGen7Parser` against.

## 3. Water-polo data map — what the data actually contains (F872 Appendix B, System 6)

This is the **legacy System 6 water-polo** channel layout (reference for field *content*; the
Gen7 wire format differs, but the water-polo *fields* are the same). Critically, **a single
channel packs MULTIPLE fields by digit position** — it is NOT "one address = one field":

| Ch | Content | | Ch | Content |
|--|--|--|--|--|
| 1 | **TIME** `88:88.88` (game clock) | | 7 | **HOME-score · CLOCK · AWAY-score** on one line `88 88:88 88` |
| 2 | **PER** `8` + **SHOT** `:88.88` | | 8 | PER + TIME variant |
| 4 | **EJECT A** (home/away cap# + time) | | 9 | **SHOT** `:88.88` standalone |
| 3 | **EJECT B** | | 10 | TIME OF DAY |
| 11 | **EJECT C** | | 12 / 6 | **TIME OUT** |
| 13 | **CAP·GOALS·CAP** (scorer recognition) | | 5 | **SCORE** (home `88` / away `88`) |
| 14 | **CAP·FOULS·CAP** (player fouls) | | 15–20 | per-cap FOULS (caps 1-7 / 8-14 / 15-22, per team) |
| | | | 21 | PER + SHOT (6-digit) |

**Our `CTS_MODULE` map is wrong on both counts** — wrong channel numbers AND wrong model. We
assume `0x02`=home score, `0x03`=away score, `0x04`=period, shot clocks `0x06/0x07`,
exclusions `0x08–0x0d`. Reality (legacy): clock=1, **period+shot together=2**, **ejects=4/3/11**,
score=5 (or packed into 7), timeouts=12/6, scorers=13, fouls=14. Only `clock=channel 1` happens
to line up.

**And the map is operator/DIP-configurable** ("Define Module" on the console + a DIP switch on
each scoreboard module). The **"Show Defs on SCBD"** diagnostic makes the board print its own
module#/channel# — use it at bring-up to read the venue's *actual* mapping.

## 4. Revised plan (de-risked by this dig)

1. **Confirm the SCBD electrical + protocol generation** — ask CTS directly (+1 970-667-1000):
   "Is the WTTC SCBD port RS-232 'CTS' or RS-485 'Gen7/WA-2'? Connector part # + pinout?" This
   one call resolves the biggest unknown. (Strong prior: RS-485 / Gen7-WA2.)
2. **Build/validate a `CtsGen7Parser`** for the Gen7/WA-2 RS-485 stream, using the
   `fabriziobertocci/coloradoScoreboard` Gen7 path as the reference. Add a `cts-wttc` /
   `cts-gen7` profile (RS-485 pins, correct baud) to `console-profiles.ts`.
3. **Cable**: WTTC SCBD round connector → EP6N **RS-485** pins (1 B- / 2 A+ / 11 GND). Spec from
   the SCBD pinout in (1).
4. **Bring-up capture (do BEFORE game day):** plug WTTC → EP6N, `cat /dev/ttyS* | xxd`, press
   each control, run **Show Defs on SCBD**, and record the real byte stream + channel map.
   Reconcile the parser to it. This is the **dress rehearsal (#138)** and it is now mandatory,
   not optional.
5. **Safety net (unchanged):** the **operator phone console + auto-celebration** runs with ZERO
   serial connection — a human taps the score, board + ribbon react. The auto-decode (legacy OR
   Gen7) is the upgrade, never a dependency. **The event is not at risk regardless.**

## 5. Honest gaps still open (need real hardware or a CTS call)

- Exact SCBD connector part # + pinout (cable build).
- Confirm RS-485/Gen7 vs RS-232/legacy on the WTTC SCBD port (protocol selection).
- The Gen7/WA-2 byte format specifics for water polo (parser build) — mine the reference repo + a capture.
- Whether the venue's scoreboard config matches any default (use Show-Defs + capture).

## Code touchpoints
- `packages/scoreboard-cts/src/console-profiles.ts` — add `cts-gen7`/`cts-wttc` (RS-485 pins).
- `packages/scoreboard-cts/src/parser.ts` + `types.ts` — currently legacy-RS-232 only; needs a Gen7/WA-2 path.
- `docs/EP6N_CTS_CABLE.md` — assumes ¼″ RS-232 source; add a WTTC (round SCBD / RS-485) variant.
- `docs/research/2026-05-28-cts-live-test/REPORT.md` — prior "live test" was a **simulator**, not real CTS bytes.

## Sources
- WTTC product page — https://coloradotime.com/products/water-polo-wireless-tabletop-controller-wttc
- WTTC Water Polo manual **F1071** (port diagram, p6) — https://www.coloradotime.com/hubfs/CTS%20Website%20%20Assets/Manuals/Multisport%20Electronic%20Scoreboards/Multisport%20Controllers/WTTC%20Water_Polo_F1071.pdf
- System 6 Water Polo manual **F872** (Appendix B channel map, Define Module) — https://coloradotime.com/hubfs/CTS%20Website%20%20Assets/Manuals/Swim%20Timing%20Components/System6/System_6_Water_Polo_Manual_F872.pdf
- CTS scoreboard protocol write-up (legacy RS-232 7-seg) — https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/
- `fabriziobertocci/coloradoScoreboard` (legacy + Gen7/WA-2 decoder reference) — https://github.com/fabriziobertocci/coloradoScoreboard
- RS-485 vs RS-232 CTS data cables (4-pin jack vs ¼″) — https://www.recreonics.com/product/colorado-time-system-sync-cable-rs-485/
