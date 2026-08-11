# Swim timing bridge — CTS scoreboard-serial → live meet results

The swim timing bridge reads a Colorado Time Systems console's
**scoreboard serial** output (System 6 / Gen 6, and Gen 7 via its RS-232
output) and feeds live lane times, places, event/heat, and dual-meet team
score into a game's results — the same `stats.results` rows the manual
Lane Pad writes, rendered by every swim board widget with zero extra
setup.

Two ways to run it:

1. **The dashboard bridge page (recommended)** — pure browser, no install.
2. **Node fallback script** — for a timing table without Chrome/Edge.

The wire protocol itself (module map, byte encoding, framing rules) is
documented in `packages/scoreboard-cts/src/swim-timing.ts` (header
comment) and `docs/research/2026-06-30-swim-dive-scoreboards/00-REPORT.md`.

---

## 1. Dashboard bridge page

**Route:** `/{schoolId}/sports/{gameId}/swim-bridge` — linked as
**"Auto-timing bridge"** from the Lane Pad header on any lane-sport game
console.

**Requirements**

- **Chrome or Edge on a laptop** (Windows / macOS / ChromeOS / Linux) at
  the timing table. Web Serial is Chromium-only — Safari and Firefox get
  a fallback panel pointing back at the manual Lane Pad, which keeps
  working everywhere.
- A **USB-RS232 adapter** (FTDI / Prolific / CH340 all fine) from the
  console's scoreboard port to the laptop. Serial settings are the CTS
  fixed defaults: **9600 baud, 8 data bits, EVEN parity, 1 stop bit** —
  the page opens the port that way automatically. For an oddball rate
  converter, add `?baud=19200` (etc.) to the page URL; the 8-E-1 framing
  is part of the protocol and not overridable.
- A dashboard login that can mint feed credentials (CONTRIBUTOR or
  above). The page mints the game-scoped HMAC feed token itself when you
  click **Connect** — nothing to copy, and the token never appears in the
  URL.

**Happy path (under 30 seconds)**

1. Open the game console → Lane Pad → **Auto-timing bridge**.
2. Click **Connect timing console**, pick the USB-serial port from the
   browser's list.
3. Watch the status card: after two clean decoded snapshots ("warming up
   1/2 → live") the bridge starts posting. Lane times appear on the wall
   board within a second of each touch.

**While the bridge is live, pause the manual Lane Pad.** Both write the
same results; the feed writes rows labeled `EVENT n — HEAT m`, and a
hand-typed row for the same heat competes with it.

**Behavior worth knowing**

- **Posting rate:** latest-wins snapshots at up to 4/s (the server
  ingest budget is 40 requests / 10 s per game). On a 429 the bridge
  doubles its spacing (max 2 s) and decays back on success — the status
  card shows "backing off" while that's happening.
- **Reconnect:** if the cable is yanked, the page polls the granted port
  every 3 s and resumes on its own — no clicks needed.
- **No checksum on the wire:** the CTS stream has no length or checksum
  bytes, so a listener that attaches mid-stream can mis-frame. The
  bridge cross-checks each lane packet's own lane byte against its
  module address (mismatches are dropped and counted as "lane-byte
  drops") and holds the first POST until two consecutive plausible
  snapshots decode ("garbage resets" counts pre-lock resyncs). Nonzero
  counters after lock-on usually mean a noisy cable.
- **Empty snapshots are dropped server-side** ("empty snapshot" status)
  until the console actually sends lane/event data — normal right after
  connecting between heats.

---

## 2. Node fallback (no Chromium at the table)

For venues that can't run Chrome/Edge, a ~60-line Node script does the
same job with the [`serialport`](https://serialport.io) package. The
decoder (`@cms/scoreboard-cts`) is deliberately Node-safe — pure, no
browser APIs — so the exact same parser runs server-side.

This is a **documented snippet, not shipped code** — run it from a repo
checkout (`pnpm install`, then `pnpm --filter @cms/scoreboard-cts run build`)
plus `npm i serialport` wherever you save the script. (Alternatively,
copy `packages/scoreboard-cts/src/swim-timing.ts` next to the script —
it has zero dependencies.)

Mint credentials first: in the dashboard, open the game console and use
the feed-credentials copy button (or `GET /api/v1/sports/games/:id/feed-credentials`
with a dashboard login), then export them:

```bash
export VENUEOS_API="https://your-api.example.com"   # no trailing /api/v1
export GAME_ID="<gameId>"
export FEED_TOKEN="<token from feed-credentials>"
node swim-bridge.mjs /dev/ttyUSB0        # or COM3 on Windows
```

```js
// swim-bridge.mjs — CTS swim scoreboard-serial → VenueOS ingest.
// Node 18+ (built-in fetch). Usage: node swim-bridge.mjs <serial-path>
import { SerialPort } from 'serialport';
import { SwimTimingParser } from '@cms/scoreboard-cts';

const API = process.env.VENUEOS_API;    // e.g. https://api.example.com
const GAME = process.env.GAME_ID;
const TOKEN = process.env.FEED_TOKEN;   // x-feed-token — header only, never a URL param
const PATH = process.argv[2] || '/dev/ttyUSB0';
if (!API || !GAME || !TOKEN) {
  console.error('Set VENUEOS_API, GAME_ID, FEED_TOKEN'); process.exit(1);
}

// CTS scoreboard serial is fixed 9600 8-E-1 (swim-timing.ts header).
const port = new SerialPort({ path: PATH, baudRate: 9600, dataBits: 8, parity: 'even', stopBits: 1 });
const parser = new SwimTimingParser();

// Latest-wins throttle: the server budget is 40 POSTs / 10 s per game
// (4 Hz). On 429 double the spacing up to 2 s; decay back on success.
const MIN_MS = 250, MAX_MS = 2000;
let intervalMs = MIN_MS, pending = null, lastPostAt = 0, posting = false;

parser.onUpdate((snapshot) => { pending = snapshot; });
port.on('data', (chunk) => parser.feed(chunk));
port.on('error', (err) => console.error('serial error:', err.message));

setInterval(async () => {
  if (posting || !pending || Date.now() - lastPostAt < intervalMs) return;
  const snap = pending; pending = null; lastPostAt = Date.now(); posting = true;
  try {
    const res = await fetch(`${API}/api/v1/sports/board/${GAME}/swim-timing-snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-feed-token': TOKEN },
      body: JSON.stringify(snap),
    });
    if (res.status === 429) {
      intervalMs = Math.min(MAX_MS, intervalMs * 2);       // rate-limited — back off
      if (!pending) pending = snap;                        // retry unless superseded
    } else if (res.ok) {
      intervalMs = Math.max(MIN_MS, Math.floor(intervalMs / 2)); // decay back
    } else {
      console.error('ingest', res.status, await res.text().catch(() => ''));
    }
  } catch (err) {
    console.error('post failed:', err.message);
    if (!pending) pending = snap;                          // network blip — retry
  } finally { posting = false; }
}, 50);

console.log(`bridging ${PATH} → ${API}/api/v1/sports/board/${GAME}/swim-timing-snapshot`);
```

Notes:

- The dashboard page additionally validates each lane packet's lane byte
  and gates the first POST on two consistent snapshots (the wire has no
  checksum). The snippet skips that hardening for brevity — the server's
  sanitizer bounds everything it persists — but attach the serial line
  **before** the console starts sending, or restart the script if the
  first decoded numbers look wrong (a mid-stream attach can mis-frame).
- Feed tokens expire (default 30 days; the mint endpoint shows the exact
  `expiresAt`). Re-mint when the script starts getting 401/403.
- Permanent installs on player hardware (Goodview EP6N / ECBox3576) can
  reuse the APK's `SerialPortBridge.kt` reader — see
  `docs/EP6N_CTS_CABLE.md` — but that path is a future wiring task, not
  built for swim yet.

---

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| "This browser can't read the timing console" panel | Safari/Firefox — use Chrome or Edge, or the Node fallback. The manual Lane Pad works in any browser. |
| Port picker shows nothing | Adapter driver missing (CH340/Prolific on Windows), or another app holds the port. |
| Bytes counter climbs but no snapshots | Wrong source device or baud override — the CTS scoreboard feed decodes only at 9600 8-E-1. Remove any `?baud=` override. |
| "Lane-byte drops" / "garbage resets" climbing steadily | Noisy or half-seated cable; check the RS-232 run. Occasional counts at connect time are normal (mid-stream attach). |
| `429 rate-limited — backing off` persists | Another bridge (or the Node script) is posting to the same game — run exactly one. |
| Results rows duplicated for a heat | The manual Lane Pad was used while the bridge was live — pause the pad (see the on-page warning). |
