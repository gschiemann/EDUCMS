# Hardware Bridge — Customer-Owned Subscriptions

> Sprint 8c (2026-05-03). Operator follow-up: "I don't mind having
> accounts that require the end customer to sign up and we just offer
> the integration with our templates."

## What this is

Several closed-platform streaming providers — **DIRECTV for Business**,
**DISH Business**, **Atmosphere TV**, **Mood Media**, **iHeart for
Business** — don't expose a public API for third-party CMS systems.
They sell their content through their own player apps + venue accounts.

But every one of them has an **HDMI output** (or runs on a Fire TV /
Apple TV / dedicated receiver that does). The customer can keep their
existing subscription, and we capture that HDMI signal, encode it as
HLS, and render it inside our CMS as a regular streaming channel —
with overlays, ad slots, schedules, and emergency takeover.

We call this the **Hardware Bridge** tier. It is:

- 🟢 **Real and works today** — every part of the chain is off-the-shelf.
- 🟢 **Cheaper than competitor signage retainers** — ~$300–700 one-time
  per venue versus $1,000+/yr stitched-together solutions.
- 🟢 **License-clean** — the customer keeps their venue subscription
  with the original provider, so the commercial-display rights are
  unchanged.
- 🟢 **Single pane of glass** — staff manage every screen + every
  source from VenueOS, including Atmosphere channels.

## The bridge architecture

```
   ┌──────────────────────┐         ┌──────────────────────┐
   │  Customer's existing │         │   USB HDMI Capture   │
   │  streaming device    │  HDMI   │   Card (~$180-400)   │
   │  (Fire TV / DTV box / │ ───→   │                      │
   │   DISH receiver)     │         │   Magewell / Elgato  │
   └──────────────────────┘         └────────┬─────────────┘
                                             │ USB 3.0
                                             ↓
                            ┌─────────────────────────────┐
                            │   Mini-PC / Raspberry Pi    │
                            │   running our Docker image  │
                            │   venueos/hls-bridge        │
                            │                             │
                            │   ffmpeg captures + encodes │
                            │   to HLS at /live.m3u8      │
                            └────────┬────────────────────┘
                                     │ Local network HLS
                                     ↓
                            ┌─────────────────────────────┐
                            │   VenueOS player on screen  │
                            │   Custom HLS connector picks │
                            │   up the local URL — done.  │
                            └─────────────────────────────┘
```

## Bill of materials (per venue, one-time)

The cheapest viable path:

| Component | Recommended | Cost |
|---|---|---|
| Streaming device (if not already on hand) | Amazon Fire TV Stick 4K | ~$50 |
| USB 3.0 HDMI capture card | Elgato HD60 X | ~$180 |
| Mini-PC (Linux) | Beelink Mini S12 | ~$170 |
| Cables + power | (HDMI, USB-C, ethernet) | ~$30 |
| **Total one-time** | | **~$430** |

Pro path (4K, rack-mount, lower latency):

| Component | Recommended | Cost |
|---|---|---|
| Capture card | Magewell USB Capture HDMI 4K Plus | ~$400 |
| Mini-PC | Intel NUC i5 | ~$300 |
| **Total one-time** | | **~$700** |

Either bill of materials beats a $1,000+/yr signage retainer in the
first year of operation.

## Setup steps (Atmosphere TV example)

The wizard inside VenueOS at **Settings → Streaming → Atmosphere TV**
walks the operator through these steps. They're identical for DIRECTV,
DISH, Mood, and iHeart — just swap "Atmosphere" for the provider's name
and the upstream device.

### 1. Customer subscribes to the provider directly

Atmosphere venue accounts are free. DIRECTV for Business and DISH Business
require a venue contract and a license. iHeart for Business runs through
Stingray. **None of this is changed by the bridge** — the customer signs
up the same way they would today.

### 2. Run the provider's app on a streaming device

- **Atmosphere**: Fire TV Stick 4K, Apple TV 4K, or their dedicated
  Atmosphere player.
- **DIRECTV / DISH**: their own receiver (satellite or IP).
- **Mood**: their ProFusion iO / iV player.
- **iHeart**: Stingray's hardware player.

### 3. Connect the device's HDMI output to a USB capture card

We recommend:

- **Magewell USB Capture HDMI 4K Plus** (~$400) — pro-grade, 4K60,
  rack-mountable. Best for sports bars or venues that want 4K.
- **AVerMedia Live Gamer ULTRA** (~$200) — solid mid-tier, 4K30.
- **Elgato HD60 X** (~$180) — cheapest reliable option, 1080p60 with
  4K passthrough.

Plug the capture card into a USB 3.0 port on the encoder PC.

### 4. Plug the capture card into a small Linux PC

A **Beelink Mini S12** (~$170), **Intel NUC** (~$300), or
**Raspberry Pi 5 + capture HAT** all work. The PC needs:

- USB 3.0 (for the capture card)
- Ethernet to your venue LAN
- Docker

### 5. Run our `venueos/hls-bridge` Docker image

Once-per-venue install. Pulls the image, mounts the capture device,
runs ffmpeg in a loop, serves HLS on port 8088.

```bash
docker run -d \
  --name venueos-hls-bridge \
  --device /dev/video0:/dev/video0 \
  -p 8088:8088 \
  -e CAPTURE_DEVICE=/dev/video0 \
  -e HLS_PATH=/live.m3u8 \
  -e RESOLUTION=1920x1080 \
  -e FRAMERATE=30 \
  -e BITRATE=4M \
  --restart unless-stopped \
  venueos/hls-bridge:latest
```

The bridge serves `http://<encoder-pc-lan-ip>:8088/live.m3u8`. That's
the URL we paste into VenueOS in step 6.

> **Note**: the `venueos/hls-bridge` Docker image is a thin wrapper
> around upstream ffmpeg + a tiny HTTP server (caddy). The operator
> can also run ffmpeg directly with their own startup script — the
> Docker image is just for one-line installs. See **manual ffmpeg
> command** below.

### 6. Connect "Custom HLS" inside VenueOS

In VenueOS:

1. Go to **Settings → Streaming**
2. Click the **Custom HLS / DASH URL** tile (TIER 5 — Custom)
3. Paste `http://<encoder-pc-lan-ip>:8088/live.m3u8`
4. Name the connection ("Atmosphere — Bar")
5. Save

The channel now appears in the **Streaming** widget on any template.
Templates render Atmosphere with our overlays, schedules, ad slots,
and emergency takeover — same as any other channel.

## Manual ffmpeg command (no Docker)

If the operator prefers to run ffmpeg directly, this command replicates
what the Docker image does. Run as a systemd service on the encoder PC:

```bash
ffmpeg -f v4l2 -framerate 30 -video_size 1920x1080 -i /dev/video0 \
  -c:v libx264 -preset veryfast -tune zerolatency -b:v 4M \
  -c:a aac -b:a 128k \
  -f hls -hls_time 4 -hls_list_size 5 -hls_flags delete_segments \
  /var/www/html/live.m3u8
```

Pair with caddy or nginx serving `/var/www/html/` on port 8088 and
the same URL works.

## Audio-only bridge (iHeart for Business)

For audio-only providers (iHeart, Pandora for Business via Mood, etc.),
the bridge skips video and captures the player's line-out / digital-out
through a USB audio interface (Behringer U-Phoria UM2 ~$30 or Focusrite
Scarlett 2i2 ~$130). The same `venueos/hls-bridge` Docker image takes
an `AUDIO_ONLY=1` flag and produces an audio-only HLS playlist that
our streaming widget renders as a "now playing" tile.

```bash
docker run -d \
  --name venueos-audio-bridge \
  --device /dev/snd:/dev/snd \
  -p 8088:8088 \
  -e AUDIO_ONLY=1 \
  -e CAPTURE_DEVICE=hw:1,0 \
  -e HLS_PATH=/audio.m3u8 \
  --restart unless-stopped \
  venueos/hls-bridge:latest
```

## Networking

- **Encoder PC must be on the same LAN as the screens** — the HLS URL
  is local-network only by default. (We never expose a venue's
  captured stream to the public internet — that would be both a
  bandwidth and a licensing problem.)
- **Recommended**: assign the encoder PC a static LAN IP or DHCP
  reservation so the URL stays stable.
- **Latency**: end-to-end ~6 seconds (HDMI capture → HLS encode →
  4-second segment → player buffer). Fine for FAST channels and
  background sports. For low-latency live (e.g. interactive
  scoreboard), use a different path.

## Reliability

The Docker image runs ffmpeg in a `--restart unless-stopped` loop, so
if ffmpeg crashes (rare; happens if the upstream device sleeps) the
container restarts automatically. The bridge survives:

- 🟢 Encoder PC reboot (Docker restarts on boot)
- 🟢 Capture card disconnect/reconnect (ffmpeg waits for /dev/video0)
- 🟢 Upstream HDMI source going to sleep (ffmpeg pauses, resumes on signal)
- 🟢 Encoder PC LAN IP change (use DHCP reservation; URL unchanged)
- 🔴 Encoder PC physical failure (no HA in v1; operator swaps the PC)
  — for HA, run two encoder PCs and front them with a load balancer

## Security

- **Local network only**. The HLS URL is exposed on the venue LAN.
  Never publish to the public internet — that would be a licensing
  violation for venue-licensed content (DIRECTV especially).
- **Bridge encoder PC has no inbound internet access by default**.
  Outbound only for Docker pull + system updates.
- **Capture card USB port** should be on the encoder PC, not on the
  venue's signage display. Don't let staff swap USB devices into the
  bridge PC.
- **VenueOS Custom HLS connector logs only the URL**, not the captured
  content. If a license auditor asks for proof, the operator's audit
  log shows the connection was a customer-managed local URL, not
  rebroadcast public content.

## Pricing positioning vs. competitors

| Competitor approach | Cost | Our bridge approach | Cost |
|---|---|---|---|
| Run Atmosphere on a separate dedicated TV next to your VenueOS screens | ~$0 hardware + signage retainer ~$1k/yr | Bridge into VenueOS — one screen, one CMS | ~$430 one-time |
| Buy Yodeck/Rise Vision premium tier with their Atmosphere connector | $30+/screen/mo | Bridge into VenueOS — flat $15/screen/mo | $15/screen/mo |
| Custom SI integration (NCR Aloha, etc.) | $5k–$25k | Bridge if hardware path exists | $430 |

## Provider-specific notes

### DIRECTV for Business
Requires a current DIRECTV venue license. Check
[business.directv.com](https://www.business.directv.com/) for
commercial-display licensing in your venue category. The bridge
does NOT change the licensing relationship — the venue still pays
DIRECTV directly.

### DISH Business
Same as DIRECTV. DISH Smartbox commercial receivers work great with
USB capture cards.

### Atmosphere TV
Free venue subscription at
[atmosphere.tv/business](https://atmosphere.tv/business/). Works on
Fire TV Stick 4K (cheapest path) or Apple TV 4K. Atmosphere keeps
their ad relationship with the venue — the bridge just gives us
pixels for the templates.

### Mood Media
Requires existing Mood Media contract + their player hardware. Capture
the player's HDMI output the same way as a streaming stick.

### iHeart for Business
Audio-only. Use a USB audio interface for line-out capture, not a video
capture card. The Stingray hardware player has both 3.5mm line-out and
digital-out (RCA / optical) — either works.

## Where this lives in the catalog

The streaming provider catalog
([`packages/api-types/src/streaming.ts`](../packages/api-types/src/streaming.ts))
declares each bridge provider with `integrationTier: 'BRIDGE'` and an
ordered `bridgeSteps` array. Both the API listing endpoint and the web
admin UI read from that catalog. Adding a new bridge provider is a
single-file change.

The web admin UI
([`apps/web/src/app/[schoolId]/settings/streaming/page.tsx`](../apps/web/src/app/[schoolId]/settings/streaming/page.tsx))
renders BRIDGE-tier tiles with a blue "Hardware bridge" badge.
Clicking the tile opens **BridgeSetupModal** — a step-by-step
checklist with concrete product recommendations. Once the operator
confirms each step, a "My capture is running — connect Custom HLS"
button hands them off to the regular Custom HLS connect modal,
prefilled with the bridge provider's name.

## Roadmap

- **v1 (this commit)**: Catalog entries + setup wizard UI + this doc.
- **v1.1**: Publish the `venueos/hls-bridge` Docker image to Docker Hub.
- **v1.2**: One-click installer script that detects the capture card
  and configures the right resolution / framerate.
- **v2**: Optional remote-monitoring of the encoder PC from VenueOS
  (heartbeat, ffmpeg status, capture card health).
- **v3**: HA bridge mode — two encoder PCs, automatic failover via
  manifest URL rotation.

## Open questions

1. **Should we sell pre-configured bridge boxes?** $430 BOM + ~$200
  margin = $629 retail. Cheaper than competitor retainers in year one.
2. **Do we want to write custom Aloha / NCR adapters?** That's not a
  hardware bridge — it's a partner-led integration with NCR. Defer
  until we have a pilot customer asking.
3. **Is there a need for a 4K bridge tier?** Most venue displays are
  1080p; 4K bridges add cost and don't add visible quality at typical
  viewing distances. Document the option but default to 1080p.
