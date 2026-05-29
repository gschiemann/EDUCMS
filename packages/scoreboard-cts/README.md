# @cms/scoreboard-cts

Scoreboard-console serial-protocol decoders for VenueOS Sprint 13.

Despite the package name, it now hosts **two** console decoders plus a
`consoleProfile` registry that maps each console family to its serial
settings + decoder:

| Console | Decoder | Serial | Sports | Status |
|---|---|---|---|---|
| **Colorado Time Systems** System 6 / Gen 6 | `CtsParser` | 9600 / 8 / **EVEN** / 1, 1/4" jack | water polo | shipped |
| **Daktronics All Sport** 5000 / 5500 / 3000 (Enhanced RTD) | `DaktronicsParser` | 19200 / 8 / **NONE** / 1, Port Expander | football, basketball, baseball/softball | **new** |

The player-side bridge (`apps/web/src/components/player/CtsBridge.tsx`)
picks a profile via the `consoleProfile` prop / `?consoleProfile=` query
param (`cts-gen6` | `daktronics-allsport`) — that single switch chooses
BOTH the serial open() settings AND the parser. Both decoders emit the
same normalized snapshot fields (`clock` / `homeScore` / `awayScore` /
`period` / `clockRunning` / `horn` + sport-specific extensions) so the
server / board / ribbon / scorebug surfaces never care which console
produced the data.

The CTS path (everything below) is unchanged.

---

## CTS — Colorado Time Systems System 6 / Gen 6

Used by the player page to convert raw bytes from a USB-RS232 dongle (plugged into the CTS console's 1/4" mono jack output) into a live water-polo game state, which then drives the on-LED ribbon scoreboard render.

## Physical layer

- RS-232 over 1/4" mono jack
- **9600 baud, 8 data bits, EVEN parity, 1 stop bit**
- Address byte: bit 7 set (>127), opens a packet for module 0x00..0x1F
- Data bytes: bit 7 clear (<128), inverted seven-segment value for one digit position
- A new address byte mid-packet closes the prior packet — no framing checksum

## Protocol references

- https://marcoscorner.walther-family.org/2015/07/colorado-timing-console-scoreboard-protocol/
- https://github.com/fabriziobertocci/coloradoScoreboard (reference Node implementation, MIT-ish)
- CTS System 6 / Gen 6 operator manual (vendor-supplied)

## Usage

```ts
import { CtsParser } from '@cms/scoreboard-cts';

const parser = new CtsParser();
parser.onUpdate((snapshot) => {
  console.log(snapshot.clock, snapshot.homeScore, '-', snapshot.awayScore);
});

// In browser: navigator.serial provides a ReadableStream of Uint8Array
const port = await navigator.serial.requestPort();
await port.open({
  baudRate: 9600,
  dataBits: 8,
  stopBits: 1,
  parity: 'even',
});
const reader = port.readable.getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  parser.feed(value);
}
```

## Public API

### `CtsParser`

- `new CtsParser()` — construction is cheap (no I/O).
- `parser.feed(bytes: Uint8Array | number[] | Buffer): void` — push raw serial bytes.
- `parser.flush(): void` — commit the in-progress packet on EOF / port close.
- `parser.onUpdate(listener): () => void` — subscribe; returns unsubscribe.
- `parser.getState(): CtsFullSnapshot` — read the latest accumulated state.
- `parser.reset(): void` — clear state but keep listeners attached.

### `CtsFullSnapshot`

Every field has a sane default so widgets can render without null-coalescing every read:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `clock` | `string` | `"0:00"` | `"M:SS"` or `":SS.t"` in the last minute |
| `period` | `number` | `1` | Water polo: 1..4 regulation, 5+ = OT |
| `homeScore` / `awayScore` | `number` | `0` | |
| `homeShotClock` / `awayShotClock` | `string` | `""` | Empty if parked |
| `homeExclusions` / `awayExclusions` | `CtsExclusion[]` | `[]` | Max 3 each; compact (no nulls) |
| `homeTimeoutsRemaining` / `awayTimeoutsRemaining` | `number` | `2` | |
| `horn` | `boolean` | `false` | One-shot — latch on rising edge |
| `receivedAt` | `number` | `0` | `Date.now()` at last update |

### `MockCtsFeed` + `scriptGame`

For dev + tests. `MockCtsFeed(consumer)` pushes synthetic CTS bytes through any consumer (parser, bridge, sink). `scriptGame(feed, [...])` runs a timeline of game events with realistic pacing. A pre-canned `REHEARSAL_SCRIPT` runs a compressed 4-quarter match in ~30 seconds — used by the dev dashboard for player-side rehearsals without a console attached.

## Module address table

| Module | Address | Bytes | Meaning |
| --- | --- | --- | --- |
| GAME_CLOCK | 0x01 | 5 | `MMSSt` |
| HOME_SCORE | 0x02 | 2-3 | digits |
| AWAY_SCORE | 0x03 | 2-3 | digits |
| PERIOD | 0x04 | 1 | digit |
| HOME_SHOT_CLOCK | 0x06 | 2 | digits |
| AWAY_SHOT_CLOCK | 0x07 | 2 | digits |
| HOME_EXCL_1..3 | 0x08..0x0A | 5 | `JJSSS` (jersey + seconds) |
| AWAY_EXCL_1..3 | 0x0B..0x0D | 5 | `JJSSS` |
| HOME_TIMEOUTS | 0x10 | 1 | digit |
| AWAY_TIMEOUTS | 0x11 | 1 | digit |
| HORN | 0x1F | 1 | any non-blank = ON |

The address space matches the **water polo profile** of a System 6 console. Other sports (basketball, soccer, hockey) reuse the same wire protocol with different module assignments — future sport profiles will live alongside this one.

## Browser compatibility

- ES2020 target, browser-safe (no Node-only APIs).
- Web Serial API consumer requires **Chrome / Edge 89+**.
- Do **not** ship this code path to a **NovaStar Taurus** LED controller — Taurus runs Chromium 83 which predates `navigator.serial`. The CTS bridge MUST run on a desktop player (e.g. a Beelink Mini PC → HDMI → NovaStar VX400 Pro processor → LED ribbon).

---

## Daktronics — All Sport 5000 / 5500 / 3000 (Enhanced RTD)

The most common HS football / basketball / baseball console. Reads its
"RTD" (Real Time Data) serial output via the All Sport Port Expander +
an FTDI/Prolific USB-serial cable.

### Physical layer

- RS-232 (and 20 mA current-loop) via the All Sport Port Expander
- **19200 baud, 8 data bits, NO parity, 1 stop bit**

### Wire protocol (positioned-text frames)

Unlike CTS's per-module seven-segment packets, the All Sport
continuously refreshes a single flat ASCII **display buffer**. Each
frame is a *positioned text write* — it carries a decimal offset and an
ASCII payload to splice in at that offset. Every named field (clock,
score, period, down, balls, …) is a fixed `(offset, length)` slice of
that buffer per sport.

```
<SYN> HEADER <SOH> CONTROL <STX> TEXT <EOT> SUM <ETB>

<SYN> = 0x16   HEADER = "00210000" (8 ASCII, prefix-checked)
<SOH> = 0x01   CONTROL = "00421NNNNN" (field prefix + 5-digit 1-based item)
<STX> = 0x02   TEXT = ASCII payload (may be empty)
<EOT> = 0x04   SUM = 2 ASCII hex = (Σ bytes from first-after-SYN .. EOT) mod 256
<ETB> = 0x17
```

The console sends **incremental** writes (only changed bytes), not the
whole buffer each cycle. The parser keeps a persistent buffer and
overwrites the addressed slice, then re-slices the active sport's fields
— so a clock-only frame leaves the score untouched, exactly like the
physical display memory. (Pressing the console STOP button forces a full
dump.)

### Public API

```ts
import { DaktronicsParser, type DaktronicsSnapshot } from '@cms/scoreboard-cts';

const parser = new DaktronicsParser({ sport: 'football' }); // | 'basketball' | 'baseball'
parser.onUpdate((snap: DaktronicsSnapshot) => {
  console.log(snap.clock, snap.homeScore, '-', snap.awayScore, snap.football?.down);
});
// feed raw serial bytes (Uint8Array | number[]):
parser.feed(bytes);
parser.setSport('basketball'); // re-derives from the same buffer
parser.getFrameStats();        // { good, bad } — bad>0 means wrong baud / noise
```

`DaktronicsSnapshot` carries the normalized fields (`sport`, `clock`,
`clockRunning`, `clockStopped`, `clockIsZero`, `period`, `homeScore`,
`awayScore`, `home/awayTimeoutsRemaining`, `horn`, `receivedAt`) plus
exactly one populated sport block (`football` / `basketball` /
`baseball`). Unlike CTS, `clockRunning` is **authoritative** (the All
Sport has an explicit clock-stopped flag) — no cadence derivation.

`MockDaktronicsFeed` + `encodeRtdPacket` / `encodeField` build valid,
checksummed RTD frames straight from the offset table — used by tests so
a wrong offset can't silently pass.

### Field offsets + provenance

`src/daktronics/offsets.ts` holds the per-sport `(offset, length)` field
maps, transcribed verbatim from the MIT-licensed reference decoder
[`zabackary/daktronics-allsport-5000-rs`](https://github.com/zabackary/daktronics-allsport-5000-rs)
(which derives from Daktronics' "All Sport 5000 Series Enhanced RTD"
manual, ED-12483). Offsets are **1-based item positions** (manual
numbering); the reader subtracts 1 for the 0-based buffer index. Also
cross-checked against [`rpitv/scoreboard`](https://github.com/rpitv/scoreboard/blob/master/daktronics_rtd_sync.rb)
and the [TimingGuys RTD protocol reference](https://timingguys.com/topic/daktronics-rtd-protocol-reference).

> **⚠️ FIELD-VALIDATION CAVEAT.** These offsets come from a community
> reverse-engineered decoder, not a console we physically tapped. The
> **high-confidence core fields** (main clock, both scores, period, the
> football down/distance/ball-on block, the baseball balls/strikes/outs
> block) are corroborated across multiple sources and are marked
> `verified: true`. **Lower-confidence fields** (play clock, possession
> indicators, basketball bonus/shot-clock, baseball hits/errors/at-bat/
> batter) are marked `verified: false` and enumerated in
> `UNVERIFIED_OFFSETS` — they need validation against a real All Sport
> console (or the Daktronics RTD simulator) before production trust,
> because per-sport offsets vary by console code/insert.

### Browser compatibility

Same as CTS — Web Serial is Chrome/Edge 89+; do **not** ship this path
to a Chromium-83 NovaStar Taurus. Runs on the desktop player (Beelink)
or the EP6N/ECBox native serial bridge.

---

## Running tests

```bash
pnpm --filter @cms/scoreboard-cts test
```

The repo uses Jest. Tests live in `src/__tests__/`:

- `parser.test.ts` — **CTS**: game start, mid-quarter ticks, goals, exclusions, end-of-quarter horn, address-byte mid-packet boundary, garbage-data tolerance, reset.
- `daktronics.test.ts` — **Daktronics**: frame framing + checksum (good accepted, bad rejected, resync on stray SYN), the three sports' core + sport-specific fields, incremental-write buffer preservation, change-only emission, authoritative clock-stopped flag, horn edges, sport-switch re-derivation, reset, and offset-table integrity (shared offsets + non-overlap guard).
