# Streaming Integration Audit Checkpoint

**Audit baseline:** `3f274702`  
**Standard Audit Surface §6 status:** Covered. Read-only code inspection; no provider credentials, protected streams, venue hardware, or DRM sources were exercised.

| Lens | Grade | Honest verdict |
|---|---:|---|
| Design | B | The settings experience is visually polished and unusually candid about bridge/closed providers. |
| UX | C | A basic HLS/public-broadcaster path exists, but connection → channel → template requires duplicated steps and several promises do not match the runtime. |
| Functionality | C− | HLS and selected iframe embeds work in principle; DASH/RTSP/NFHS/Facebook are absent, manual YouTube/Twitch channel creation is broken, signed URL refresh is not implemented, and ad-slot scheduling is schema-only. |

## Capability inventory

| Capability | Status | Evidence / truth |
|---|---|---|
| HLS / M3U8 | Built, incomplete | Native Safari HLS plus lazy `hls.js` fallback at `apps/web/src/components/widgets/StreamingWidget.tsx:192-245`. No durable runtime health/failover/canary proof. |
| MPEG-DASH | N/A—not built | Explicitly rejected at `StreamingWidget.tsx:147-161` and `apps/api/src/streaming/streaming.service.ts:462-472`. |
| RTSP / RTMP | N/A—not built | Renderer shows “requires transcode” at `StreamingWidget.tsx:135-145`; no gateway service exists. |
| YouTube | Partially built | URL normalization exists at `StreamingWidget.tsx:281-303`, but manual channel persistence drops its URL; see P1 below. |
| Twitch | Partially built | Embed normalization exists at `StreamingWidget.tsx:304-312`, but the same persistence defect applies. No Chromium-83 or real-host canary. |
| Vimeo | Assisted/partial | Embed normalization exists at `StreamingWidget.tsx:313-318`; OAuth is explicitly unbuilt and cataloged PARTNER. |
| Facebook Live | N/A—not built | No provider/normalizer/runtime path. |
| Periscope | N/A/obsolete | No path; the discontinued service should be removed from the standing product checklist rather than promised. |
| Public broadcasters | Built, needs canaries/legal registry | Curated YouTube-live presets exist in `packages/api-types/src/streaming-presets.ts`; no continuous embed-availability canary. |
| NFHS Network | N/A—not built as a software integration | Hardware copy describes HDMI capture, but there is no NFHS adapter, OAuth, data path, or overlay contract. |
| Webcam URL | Partial generic fallback | An arbitrary public HTTP(S) URL may fall through to iframe; no explicit webcam capability, permission model, or tested formats. |
| Stream as scheduled playlist asset | N/A—not built | Streaming is a template widget/channel snapshot, not an `Asset`/playlist item with scheduling and offline semantics. |
| RTSP responder share link | N/A—not built | No responder bridge, authorization, transcoder lifecycle, or temporary share-link path. |
| Scheduled stream ad overlays | Schema/demo-only | `StreamAdSlot` exists at `packages/database/prisma/schema.prisma:1670-1692`; no CRUD/controller/scheduling UI exists, and the settings header calls it future work. |

## P1 — manual YouTube/Twitch/Vimeo channel creation drops the playback URL

The primary “paste a URL” path is broken:

1. The settings flow detects an iframe URL, but sends `playbackUrl: undefined` at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:762-773`.
2. `StreamingService.addChannel` persists the missing value without deriving it from `externalId` at `apps/api/src/streaming/streaming.service.ts:223-251`.
3. The template picker copies that missing value into widget config at `apps/web/src/components/template-builder/PropertiesPanel.tsx:5060-5069`.
4. The widget requires `playbackUrl` or `embedUrl` and otherwise renders “No channel selected” at `apps/web/src/components/widgets/StreamingWidget.tsx:118-133`.

### Required implementation

- Store a canonical source URL for every channel, regardless of playback kind.
- Derive `embedUrl` server-side through a shared canonicalizer; never duplicate provider parsing in settings and renderer.
- Add one browser E2E per DIRECT iframe provider: connect → paste → validate → add channel → bind widget → render in player.
- Backfill existing iframe channels whose URL survived only in `externalId`.

**Acceptance:** a real public YouTube and Twitch URL persists, reopens, previews, and plays after a full reload and on the paired-player route.

## P1 — the runtime snapshots a URL; it does not resolve a channel

Comments claim channel IDs resolve through `/streaming/channels/:id`, including signed-URL refresh (`WidgetRenderer.tsx:99-103` and `PropertiesPanel.tsx:9525-9528`). The actual widget never fetches a channel. The editor copies `playbackUrl` into template JSON once at `PropertiesPanel.tsx:5060-5069`, and `StreamingWidget` only reads that snapshot. `resolvePlayback` is user-JWT-protected and simply returns the stored URL at `apps/api/src/streaming/streaming.service.ts:281-295`; no device-authenticated resolver or signed URL refresh exists.

### Required implementation

- Persist only `streamingChannelId` in the design document.
- Resolve playback through a device-authenticated endpoint included in the player manifest or a short-lived device URL.
- Track channel version, credential health, expiry, last verification, and backup URL.
- Refresh signed URLs before expiry without requiring template resave/redeploy.
- When a connection/channel is revoked, every player must stop using the stale snapshot immediately.

**Acceptance:** rotate a signed HLS URL while a player is live; the player changes URL without editing the template. Revoking the channel replaces playback with the configured fallback within the SLA.

## P1 — Custom HLS and IPTV UX overpromise

- A Custom HLS connection stores the URL inside encrypted credentials but does not create a channel. The operator must paste the same URL again in “Pick channels.”
- Custom-HLS connections remain `PENDING` forever because only `none`/`iframeOnly` auto-activate at `apps/api/src/streaming/streaming.service.ts:134-150`, even when the URL validator succeeds.
- The catalog says “Upload a .m3u / .m3u8 playlist file” at `packages/api-types/src/streaming.ts:388-400`; the UI only exposes a text URL at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:618-625`, and there is no playlist-file parser/import.
- The settings hero says “We handle the setup” at `apps/web/src/app/[schoolId]/settings/streaming/page.tsx:150-155`, but the bridge workflow requires an external capture device, mini-PC, ffmpeg/HLS server, repeated URL entry, channel selection, and manual widget binding.

### Required implementation

Collapse HLS into one transaction: paste URL → validate → create ACTIVE connection + canonical channel → offer “Add to a screen.” Implement a real bounded M3U parser if the upload claim remains; otherwise rename the provider to “HLS channel URL.” Provide a downloadable, supported bridge appliance only when it actually exists and is supportable.

**Acceptance:** a nontechnical operator goes from one `.m3u8` URL to a playing screen in ≤30 seconds without entering the URL twice or visiting the template builder.

## P1 — no production playback health, recovery, or observability

The HLS widget surfaces fatal errors as an 11px overlay (`StreamingWidget.tsx:229-260`) but has no explicit recovery state machine, backup source, operator alert, black-frame/frozen-frame detection, acknowledgement, or stream SLA telemetry. Provider/catalog health is configuration-driven rather than a continuously verified playback operation.

### Required implementation

Create a `StreamPlaybackSession` state machine with `CONNECTING`, `PLAYING`, `BUFFERING`, `DEGRADED`, `FAILED`, and `FALLBACK`; bounded exponential recovery; fatal-media recovery; backup channel/slate; and player acknowledgements. Measure startup time, rebuffer ratio, fatal rate, last decoded frame, audio state, and URL-expiry refresh. Expose a fleet “stream health” view and alerts.

**Acceptance:** kill the origin, rotate the URL, corrupt a segment, and restore it. The screen never stays black, uses the declared fallback, and the dashboard shows the same state with timestamps.

## P1 — arbitrary iframe fallback and hard-coded legal status need governance

Unknown public HTTP(S) URLs are accepted with a warning at `apps/api/src/streaming/streaming.service.ts:475-482`, then rendered as an unsandboxed iframe if selected (`StreamingWidget.tsx:266-320`). Commercial-use legality is a hard-coded catalog boolean with no review date, counsel owner, terms version, or evidence artifact in `packages/api-types/src/streaming.ts`.

### Required implementation

- Allowlist playback adapters and explicitly classify generic iframe content separately from streaming.
- Apply provider-specific sandbox/permission policy and a restrictive frame CSP.
- Add `termsReviewedAt`, `termsUrl`, `reviewer`, `allowedUse`, and `overlayPolicy` to the provider release manifest.
- Default unknown sources to “unverified custom embed,” never to a green venue-safe claim.

## P1 — streaming credentials reuse the device-token secret

Streaming envelope encryption wraps credentials with `DEVICE_SECRET_KEY` and has no key version at `apps/api/src/streaming/creds-cipher.ts:10-25`, `:33-45`. This prevents clean separation and rotation.

Use a dedicated KMS/`STREAMING_CREDENTIAL_KEK`, store key version, support dual-read/rewrap rotation, and audit create/test/rotate/revoke. Never return a silently empty object on credential JSON parse failure (`creds-cipher.ts:83-93`).

## Test and release gate

No focused streaming service/widget/settings tests were found. Add:

1. Unit contract tests for URL canonicalization and provider capability policy.
2. API tests for tenant scope, validation, connection status, audit, channel lifecycle, and device playback resolution.
3. Browser E2E for HLS, YouTube, Twitch, fallback, revoked channel, and autoplay policy in Chromium/WebKit.
4. Chromium-83/Taurus playback canary for H.264 HLS and a supported iframe provider.
5. Nightly external canaries for every curated public broadcaster, recording “provider unavailable” separately from product regression.

## Recommended sequence

1. Fix iframe URL persistence and remove false IPTV/upload claims.
2. Replace URL snapshots with device-authenticated channel resolution.
3. Collapse the HLS happy path and add health/recovery telemetry.
4. Build real ad-slot scheduling and stream-as-asset semantics only after the core resolver is durable.
5. Treat DASH, RTSP responder bridge, NFHS, and Facebook as explicit roadmap work—not shipped integrations.
