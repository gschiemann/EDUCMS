# 03 — NovaStar Taurus Native "Synchronous Playback" vs VenueOS Frame-Locked Sync

**Date:** 2026-07-28 · **Source:** NovaStar *Multimedia Players Synchronous
Playback Configuration Guide* V2.0.2 (2026-04-30, TB/TCC/TU series) — reviewed
page-by-page against what we shipped.

## What their feature is

NovaStar's native sync applies to their **asynchronous-mode built-in player**
(ViPlex/VNNOX "solutions" stored on the box) — *not* the WebView layer VenueOS
runs on the same hardware. Mechanism: synchronize the boxes' **system clocks**
(NTP over LAN/public internet, LoRa RF modules with ~2km radius, or GPS via a
4G module + antenna), then enable a "Synchronous Playback" toggle so each box
plays its stored solution keyed to the shared clock. Their own note: sync
correction runs **once every minute**; playback free-runs between corrections.

Same architectural family as ours (shared clock + deterministic schedule — the
design our research doc identified as the industry-correct one). That's the
validation. Everything else differs.

## Their constraints (from §3, verbatim-level)

- Players must be the **same model AND same firmware version**.
- All players play **identical content**; media limited to image/video.
- **One media item per page**, play count 1, **≥2 pages**, pages
  **permanently valid** (no dayparting), **no image special effects**.
- Video ceiling: 1×1080p (H.264/H.265/VP9; 480p other codecs); 4K on TU4K Pro only.
- Manual per-venue setup in ViPlex Express: stand up/point to an NTP server
  (firewall UDP 123), batch-configure every box, enable toggle, publish.
- RF mode: the master device **cannot play content** (it's only a clock).
- No published precision numbers anywhere in the document.

## Side-by-side

| | NovaStar native sync | VenueOS frame-locked sync |
|---|---|---|
| What it syncs | Their built-in solution player | The full VenueOS layer: templates, HTML boards, widgets, live data, playlists, emergency overlays |
| Content | 1 static media per page, identical loop, no effects, no dayparts | Anything the player renders |
| Hardware mix | Same model + same firmware required | Mixed models — per-device measured render-lead + trim + camera calibration absorb differences |
| Setup | Per-venue NTP server/ViPlex config/firewall | One dashboard toggle; clock rides our existing authenticated WS/HTTP |
| Correction cadence | Clock corrected ~1×/minute; playback free-runs between | Continuous: adaptive 5–30s clock sampling, ≤2ms/s slew, per-frame conductor, 4×/s video servo |
| Cross-device | Taurus/TB/TCC/TU family only | Taurus + Pi + generic Android + web together |
| Health visibility | Green/yellow bubble in a LAN desktop utility | Per-screen ±ms badges, content-mismatch detection, jitter coaching, HUD, telemetry history |
| Glass latency | Unaddressed (same-model rule sidesteps it) | Trim + fleet-learned model presets + phone-camera auto-calibration |

## What they have that we don't (the honest gaps)

1. **GPS time sync** — a box with *no network at all* (off-grid outdoor LED,
   highway boards) can still share a clock via GPS antenna. Our sync needs to
   reach the cloud at least periodically (we coast well on the skew model, but
   not indefinitely). Niche for our current verticals; noted for a future
   off-grid story.
2. **RF/LoRa clock distribution** — same no-network niche, 2km radius,
   dedicated hardware, master can't play content.
3. **LAN-local clock master** (Taurus-as-NTP-server) — a site keeps mutual
   sync with zero internet. Our screens coast (drift-modeled) through outages
   but have no local mutual reference during a *long* one. Browser-to-browser
   LAN clocking would need WebRTC — not worth it today.
4. (Ecosystem, not this doc): their controller/Pro-AV line can align at
   HDMI-scanout level — physically impossible from a browser; our research doc
   already scopes the ±1-frame floor honestly.

## Actionable takeaways

1. **Complementary, not competing — recommend enabling their NTP box-level
   time sync on Taurus fleets** (ViPlex → `ntp.vnnox.com` or venue NTP). A
   disciplined Android system clock improves our coarse AUTH_OK fallback, the
   emergency freshness gate, and post-reboot behavior. Zero code — an install-
   guide line.
2. Their troubleshooting checklist (timezone consistency, UDP 123, "WiFi
   latency <200ms") is fully covered by our jitter coaching + HUD.
3. Positioning line for sales, defensible from their own doc: *NovaStar's
   native sync requires identical hardware, identical single-media loops, and
   an on-site NTP server, and corrects time once per minute. VenueOS
   frame-locks any content, on mixed hardware, from the cloud, adjusting
   continuously — with per-screen proof.*
