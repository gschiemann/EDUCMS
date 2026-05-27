# Goodview EP6N — VenueOS hardware-target evaluation

> Drop-in evaluation written 2026-05-27 against the EP6N V1.0 spec sheet
> Greg dropped overnight. The EP6N is a **drop-in upgrade candidate over
> the ECBox3576** (`docs/ECBOX3576_CTS_SETUP.md`) for installs where any
> of the following matter: dual native RS232, GPIO/dry-contact integration,
> HDMI capture, in-line network, on-device AI, or 24/7 duty.
>
> For the **live water polo install** (~30 days out at time of writing),
> this is worth pricing alongside the ECBox to see if the swap is
> budget-feasible — every difference below favors the EP6N.

---

## What it is, in one sentence

A 190 × 106 × 38 mm aluminum-chassis Android 14 media player on Rockchip
RK3576 (8-core, 2.2 GHz) with a 6 TOPS NPU, **dual native RS232 ports +
RS485 + GPIO on a Phoenix terminal**, HDMI **in AND out**, and **RJ45
in AND out** — all factory-rated for 24/7 duty.

It is, functionally, the ECBox3576's bigger sibling: same SoC family,
same OS, but a richer I/O ring that closes several integration gaps
that have been driving custom cable orders and one-off USB-serial
adapters in the field.

## Spec snapshot

| | |
|---|---|
| **SoC** | Rockchip RK3576 — Quad Cortex-A72 + Quad A53, 2.2 GHz |
| **NPU** | 6.0 TOPS @ INT8 (also INT4/16/FP16/BF16/TF32) |
| **OS** | Android 14 |
| **RAM / Storage** | 4 GB / 64 GB UFS |
| **GPU** | Mali-G52 MC3 — OpenGL ES 3.2, Vulkan 1.1, OpenCL 2.0 |
| **Video decode** | 4K H.264 / H.265 |
| **Power** | 12 V / 2 A, ≤ 9.6 W |
| **Duty cycle** | 24/7 rated |
| **Dimensions / weight** | 190 × 106 × 37.7 mm, 0.566 kg |
| **Working temp** | 0 °C → 40 °C, 20–80 % RH |
| **Chassis** | All-aluminum (passive cooling, no fan) |

## I/O ring — the buy

| Port | Count | What it unlocks |
|---|---|---|
| **HDMI OUT** (4K) | 1 | Drive the display (same as every player) |
| **HDMI IN** (4K) | 1 | **Capture an external feed** — broadcast overlay, ref-cam, customer-supplied source. No USB capture card needed. |
| **RJ45 IN / OUT** | 1 + 1 | **In-line network passthrough** — one drop, player + downstream device |
| **USB 3.0** | 1 (Type-A) | Storage / aux |
| **USB 2.0** | 2 (Type-A) | Remote control / keyboard / sneakernet |
| **USB-C 3.2 Gen1** | 1 | Aux |
| **Phoenix Terminal** (one connector, multiple pins): | | |
|  ↳ RS485 (B− / A+) | 1 | Daktronics All Sport / Nevco console tap-off |
|  ↳ RS232 #1 (RX/TX) | 1 | **CTS Gen 6** console — no USB-to-serial adapter |
|  ↳ RS232 #2 (RX/TX) | 1 | Second serial device (Stream Deck adapter, aux scoreboard, etc.) |
|  ↳ GPIO OUT1 / OUT2 | 2 | **Drive relays** — door strike, alarm contact, status lamp |
|  ↳ GPIO IN1 / IN2 | 2 | **Read dry contacts** — fire alarm, panic button, door sensor |
|  ↳ 12 V power out | 1 | Self-power a low-draw aux device off the same supply |
| **Audio out** | 1 (3.5 mm) | Headphone / line out |
| **Status LEDs** | 2 (PW + WK) | Visual triage in the rack |
| **Hardware buttons** | Reset, Recovery, Power | OTA flash + provisioning |

## EP6N vs ECBox3576 — head-to-head

| Capability | ECBox3576 (today) | EP6N (this eval) | Why it matters |
|---|---|---|---|
| SoC | RK3576 family | RK3576 — A72×4 + A53×4 @ 2.2 GHz | Same APK ships unmodified |
| OS | Android 14 | Android 14 | No WebView regression risk |
| NPU | ~3 TOPS (per ECBox docs) | **6 TOPS** | Headroom for on-device AI |
| RAM / Storage | 2 GB / 16 GB (typical) | **4 GB / 64 GB UFS** | Larger emergency cache; faster cold-boot |
| RS232 native ports | 1 (via Phoenix term) | **2 (Phoenix term)** | CTS + Stream Deck on the same box, no USB-serial dongle |
| RS485 | ✓ | ✓ | Same. Daktronics / Nevco path unchanged |
| GPIO IN / OUT | Limited | **2 in + 2 out** | Fire-alarm dry-contact, panic-button hardwire, door strike, status lamp |
| HDMI IN | ✗ | **✓ (4K)** | Capture broadcast feed for streaming overlay (Sprint 13 god-tier) without a $180 capture card |
| HDMI OUT | ✓ | ✓ | Same |
| RJ45 IN + OUT (passthrough) | ✗ (single port) | **✓** | One network drop services the player + a downstream device (camera, secondary screen) |
| USB ports | Fewer | 3× USB-A + 1× USB-C | Sneakernet + peripherals + future expansion |
| 12 V aux output | ✗ | **✓ (on Phoenix term)** | Power a low-draw aux device off the same supply |
| Chassis | Plastic (typical) | **All-aluminum, passive** | No fan = no fan failure mode at 2 a.m. |
| Duty cycle rating | Commercial | **24/7 explicitly rated** | Defensible for stadium / lobby contracts |
| Dimensions | ~140 × 100 × 30 mm | 190 × 106 × 38 mm | Slightly larger — verify rack/back-of-display fit |
| Weight | ~0.4 kg | 0.566 kg | Negligible |
| Working temp | 0–40 °C | 0–40 °C | Same |
| Decode | 4K H.264/H.265 | 4K H.264/H.265 | Same — single 4K stream is the comfortable cap |

**Bottom line:** the EP6N is "ECBox3576 with the I/O ring filled in."
The chip + OS are familiar, the APK does not need a rebuild, and the
new ports each close a specific gap we've been working around with
adapters.

## What this unlocks for VenueOS

Bucket each by which sprint / capability gets cheaper or higher-confidence:

### Sprint 13 (Sports / live install)
- **CTS bridge** uses RS232 #1 directly — drop the USB-serial dongle
  pattern in `apps/web/src/components/player/CtsBridge.tsx` for installs
  on this hardware. Cable spec already covers this (CTS 1/4" mono →
  Phoenix RS232 #1 RX + GND, same as `docs/ECBOX3576_CTS_SETUP.md` §
  "Cable spec").
- **Stream Deck via serial** on RS232 #2 — cheap physical cue panel
  next to the operator without adding USB.
- **Auto-celebration via crowd audio** — the 6 TOPS NPU can run a
  small audio-classifier on-device (cheer-vs-applause-vs-whistle).
  Not in the codebase yet; mentioned as god-tier in CLAUDE.md
  Sprint 13 §10.
- **Streaming overlay (NFHS Network / Hudl)** — HDMI IN can capture
  the broadcast feed; player composites the scorebug overlay; HDMI
  OUT feeds the venue display. The current architecture assumes a
  separate USB capture card (~$180–400 from `docs/HARDWARE_BRIDGE.md`).
  EP6N collapses that BOM line.

### Emergency / safety system
- **Hardware panic button** — wire a dry-contact panic switch to GPIO
  IN1. The existing emergency-trigger code path is mediation-ready
  (signed pub/sub, hold-to-trigger UX); a dry-contact wire is just
  another input. No new server work; just a small APK listener.
- **Fire-alarm integration** — GPIO IN2 reads the building fire panel
  dry contact. The CLAUDE.md V2 Phase 1 spec calls for "dry-contact +
  webhook adapter for fire/access/door systems"; this is the
  dry-contact half wired to a single screen, no central appliance.
- **Status lamp / horn output** — GPIO OUT drives a relay to a lobby
  lamp or audible horn during emergency states. Visible safety signal
  layered on top of the screen content.

### Integration / multi-system
- **Door / access integration** — GPIO IN3 reads "door is open"; GPIO
  OUT1 drives a magnetic strike on emergency unlock. Pairs with the
  V2 Responder Bridge spec.
- **In-line network** — the RJ45 IN/OUT passthrough turns the player
  into a single network drop that ALSO serves a downstream camera /
  IP speaker / aux screen. Eliminates a switch port at the wall —
  meaningful in older HS gyms with limited drops.
- **AI alt-text + branding on-device** — the 6 TOPS NPU can run the
  alt-text model on-device. The current path (commit `87cf727`) calls
  OpenAI 4o-mini vision; on EP6N we can keep that as the cloud path
  but ALSO offer a free, offline mode for tenants without BYOK AI.

## When to choose EP6N vs ECBox3576

**Pick EP6N when ANY of these are true:**
- Customer install needs more than one serial device (CTS + something else)
- Customer wants a hardware panic / fire-alarm dry contact
- The display surface needs broadcast capture (sports streaming, ref-cam)
- The install is rack-mounted in a non-climate-controlled mechanical room (passive cooling matters)
- The install is mission-critical 24/7 (defensibility — vendor explicitly rates the EP6N for 24/7)

**Pick ECBox3576 when:**
- Single-purpose digital signage with no live-data sources
- Budget-constrained pilot installs
- The single-RS232 path is enough (existing CTS setup, no Stream Deck)

**For the live water polo install specifically:** this comes down to
budget. The EP6N's dual RS232 lets us standardize on the Phoenix terminal
for ALL serial paths and removes the USB-serial dongle as a failure
mode. Worth pricing.

## Open questions before standardizing on it

The spec sheet leaves these unanswered — confirm with Goodview before
ordering quantity:

1. **Unit price** — TBD in spec. Need a quote vs. the ECBox3576's
   ~$300–400 BOM line.
2. **APK sideload path** — assumed same as ECBox (Recovery button on
   the rear + ADB over USB), but the EP6N may have a Goodview MDM
   layer that wants approval. Test before assuming OTA works.
3. **Phoenix terminal connector model** — the doc lists "Phoenix
   Terminal" but not the specific plug. Order a sample with the unit
   so we can validate the 2-pole MC 1,5/2-ST-3,81 plugs from the
   ECBox setup still fit.
4. **HDMI IN latency** — for the streaming-overlay use case, 1–2
   frames is fine; 5+ frames is broken. Test capture-to-composite
   latency with a real broadcast feed before quoting Sprint 13
   streaming.
5. **GPIO voltage / current ratings** — driving a relay needs ~3.3 V
   logic at ~10 mA typical, but the spec doesn't publish the limits.
   Verify before designing a fire-alarm hookup.
6. **NPU model-conversion path** — listed support for TensorFlow /
   MXNet / PyTorch / Caffe. RKNN toolkit version matters; confirm
   the toolchain we'd use for on-device alt-text or audio-cheer
   detection.
7. **Bootloader unlock / root** — needed if we ever want to ship a
   kiosk-locked image. Goodview may gate this; ask.

## BOM additions (for a single EP6N install)

Same shape as the ECBox3576 install (`docs/ECBOX3576_CTS_SETUP.md`),
with these line-item differences:

| Item | Quantity | Notes |
|---|---|---|
| Goodview EP6N | 1 | TBD pricing; quote alongside ECBox |
| HDMI cable, 6 ft | 1 | Ships with the box |
| Phoenix terminal plug | 1 | **Ships with the box** — verify it matches the existing ECBox plug spec; if not, order a spare from Phoenix Contact |
| WiFi antenna | 1 | Ships with the box |
| Remote control + 2× batteries | 1 | Ships with the box |
| 12 V / 2 A barrel power supply | 1 | Ships with the box |
| Custom CTS 1/4" mono → Phoenix RS232 cable | 1 | Same as ECBox install. Cable spec in `docs/ECBOX3576_CTS_SETUP.md` § Cable spec |
| (optional) Stream Deck → RS232 cable | 1 | Sprint 13 cue-panel hardware path |
| (optional) Fire-alarm dry-contact pigtail to GPIO IN | 1 | V2 safety integration |
| (optional) Status-lamp relay to GPIO OUT | 1 | V2 safety integration |

## Status

- **Not yet field-tested.** This eval is paper + spec-sheet only. Before
  recommending the EP6N to a paying customer, order one unit, walk it
  through the standard provisioning flow in `docs/MANAGER_PROVISIONING.md`,
  and run the Player APK against it.
- **Compatible with existing APK assuming Android 14 + RK3576.** The
  EP6N is the same SoC family + OS as the ECBox3576, so the APK should
  install unchanged. The new I/O is opt-in — code reads the RS232 #2
  port only if a config flag points at it.
- **CTS bridge:** `apps/web/src/components/player/CtsBridge.tsx`
  consumes serial bytes via the same parser regardless of how those
  bytes arrived (USB-serial vs native Phoenix RS232), so swapping
  hardware doesn't touch app code.

## Action items if Greg green-lights field-testing

1. Order one EP6N + power adapter (vendor quote first).
2. Verify the Phoenix plug shipped in the box matches the existing
   cable spec. If not, order 5 spare Phoenix Contact 1803578 plugs.
3. Flash the current Player APK via the Manager OTA path
   (`docs/MANAGER_PROVISIONING.md`).
4. Pair to a test tenant + screen via the dashboard pair-code flow.
5. Plug the CTS-emulator output into RS232 #1; verify
   `apps/web/src/components/player/CtsBridge.tsx` parses and the
   `/board/<gameId>` page shows live scores.
6. Plug a USB stick with a signed manifest into a USB port; verify
   USB sneakernet ingestion still works (`apps/api/src/usb-export/`).
7. Drive a 4K test pattern from HDMI IN; verify the player can see it
   via Android's CameraX/HDMI-input API (Goodview-specific —
   may need their SDK).
8. Fire a dry-contact across GPIO IN1; confirm a small native handler
   in the APK detects the edge.
9. Pull WiFi for 60 s with content cached; verify emergency-cache
   playback continues (`apps/web/public/sw-player.js`).
10. Report back; add a "field-tested" section to this doc with date
    + APK version + any quirks discovered.
