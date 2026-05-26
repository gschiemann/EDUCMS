# @cms/scoreboard-cts

Colorado Time Systems (CTS) **System 6 / Gen 6** scoreboard protocol decoder for VenueOS Sprint 13.

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

## Running tests

```bash
pnpm --filter @cms/scoreboard-cts test
```

The repo uses Jest. Tests live in `src/__tests__/parser.test.ts` and cover game start, mid-quarter ticks, goals, exclusions, end-of-quarter horn, address-byte mid-packet boundary, garbage-data tolerance, and reset.
