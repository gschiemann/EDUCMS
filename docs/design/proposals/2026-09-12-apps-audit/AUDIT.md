# Apps audit — 2026-09-12

Baseline: `e4e018bb`. Scope: Apps discovery → link conversion → setup → canvas mutation → player dispatch and relevant proxy/feed paths. Local functional testing plus source review and official provider documentation. No changes to product code, accounts, secrets or production data.

## Required audit-surface coverage

“Covered” means covered **within this Apps-tab scope**, not whole-system certification. Broader subdomains are explicitly deferred.

| Standard surface | Coverage and limit |
|---|---|
| 1. Real-time / signed pub-sub | Deferred: emergency delivery not invoked; preserve all existing safeguards. |
| 2. Storage / content pipeline | Covered: generated zone shape, iframe/proxy dispatch and source handling; storage ACL/upload security deferred. |
| 3. AI providers | Covered: Apps AI request/response boundary; actual providers, billing and BYOK execution deferred. |
| 4. AI feature surfaces | Covered: Apps “Design one with AI” and concierge; unrelated AI features deferred. |
| 5. AI-tool comparative scan | Deferred: not an AI-vendor selection audit. |
| 6. Streaming integrations | Covered: Apps YouTube/Vimeo/Twitch conversion and embed paths; real playback/hardware deferred. |
| 7. Sports integrations | Deferred: outside this tab. |
| 8. POS integrations | Deferred: outside this tab. |
| 9. Communications | Deferred: no email/chat integration in this scope. |
| 10. Auth / identity | Covered: public-source assumptions, tenant cache key and secret-feed risks; full RBAC/OAuth penetration test deferred. |
| 11. Billing / commerce | Covered: commercial weather-service prerequisite and unbuilt paid integrations; billing implementation deferred. |
| 12. Design imports | Covered: Slides, PowerPoint and Canva entry paths; upload conversion pipelines deferred. |
| 13. Public alerts | Deferred: no emergency testing or changes authorized in this UI review. |
| 14. Multi-vertical | Covered: actual catalog filtering and proposed industry defaults. |
| 15. Cross-browser / Chromium 83 | Covered: renderer/style constraints and current Chromium form harness; actual Chromium 83/WebKit/Firefox/hardware qualification deferred. |
| 16. Forensic / audit | Covered: proposed source actions, tenant scope and redaction; immutable production AuditLog verification deferred. |
| 17. Operations / DX | Covered: isolated reproducible tests and dependency-resolution failures; CI/deployment not run or changed. |
| 18. Accessibility | Covered: source-level controls/focus and redesign criteria; formal assistive-technology audit deferred. |
| 19. Widget editability | Covered: add/configure boundary, source provenance and reopening gap. |
| 20. Design / UX / functionality | Covered: all 19 entries, current controls and replacement interaction design. |
| 21. Verification discipline | Covered: exact test evidence, source-vs-runtime distinctions and untested boundaries below. |

## What “works” means here

- **Locally verified:** real code ran in tests; provider requests may be mocked. This can prove conversion, rendering of returned fixture data, QR image decoding or disabled-state behavior.
- **Source-confirmed:** branch/configuration is present in the committed code. No claim that its provider accepted it in a deployed player.
- **Reproduced defect:** a deterministic input produced an incorrect result in executed code. Three form defects were also reproduced in Chromium.
- **Unimplemented:** explicitly `comingSoon`, empty schema and placeholder build; user cannot add it.

The 15-entry form smoke checks establish that nonempty input can trigger mutations. They do **not** validate those inputs against each provider. Provider playback, signed render capability issuance, authenticated save/reload and hardware output remain unverified.

## Every current app: keep, fix or retire

All registry references below are in `apps/web/src/components/apps/app-registry.ts` at this commit.

| App / registry line | What exists and what actually passed | Failure / limitation | Decision |
|---|---|---|---|
| YouTube / 270 | STREAMING; normal video/share URL survives both normalization layers in executed tests. Muted option is wired. | Playlist is misclassified as Web Page; reordered query parameters fail video extraction; `/channel/ID/live` stays a page URL; handles are put in a channel-ID parameter without resolution. No proof of unattended playback, captions, restricted-video handling or provider readiness. | **Keep; P1 repair.** Video-first default. Advertise playlists/live only after separate tests pass. |
| Vimeo / 319 | Public numeric video ID becomes the official player URL in executed tests. | Both add-time and player-time conversion discard unlisted privacy hashes. Domain restrictions still apply. | **Keep; P1 repair.** Preserve `h` through editing, save/reload and playback. |
| Twitch / 362 | Bare channel → canonical channel → player URL; current hostname supplies `parent`. | No target-size or nested-parent qualification; offline streams, autoplay and school network blocks not tested. VOD/clip URLs are not implemented by the channel-only form. | **Keep as advanced / esports; P2 qualification.** Not a school default. |
| Google Slides / 389 | Recognized deck ID becomes an embed URL with start/loop/delay parameters. | `staticMode:true` strips script-driven behavior downstream. Delay/loop controls do not establish a working slideshow. An edit URL does not make a private deck public. | **Keep; P1 renderer repair.** Prefer publish-approved slide rotation or qualified official embed. |
| PowerPoint / 437 | Extracts `src` from a supplied iframe snippet. | Generic share links are not transformed into official embeds; personal OneDrive and work/school links differ. Static mode cannot preserve an Office web app. “Share link” label overpromises. | **Keep narrowly; P1 repair.** Official embed or existing import/export workflow, not any OneDrive URL. |
| Canva / 459 | Simple public `/view` link gains an `embed` parameter; uses interactive WEBPAGE proxy. | Raw embed HTML is not extracted; URL fragment handling can put `embed` in the fragment. Proxying a complex provider app is not equivalent to official embedding. Editing/private links not reliably rejected. | **Keep; P1 source/renderer qualification.** Add existing media/PDF export fallback, not a second import system. |
| Google Sheets / 482 | Already-published `pubhtml` URL is preserved in executed tests. | Edit-link conversion drops selected `gid`; renders a spreadsheet page, not a designed data board. Static mode alone does not guarantee freshness. Blurb suggests “roster” while setup asks to publish publicly. | **Keep; P1 privacy + tab/range repair.** Default to a public-data board; protect private-source work behind a separate authenticated integration. |
| Web Page / URL / 526 | WEBPAGE with refresh setting and interactive proxy; nonempty inputs create zones. | “Any website” is false: auth, CSP/frame restrictions, cookies, challenges and dynamic applications vary. Invalid text can be added; no compatibility verdict. | **Keep as Advanced; P1 validation.** Rename “Website embed”; unsupported is an explicit result, not a retry loop. |
| Google Maps / 566 | Address text produces a keyless query embed URL; existing map embed URL passes through. | Whole share URLs become address queries; short links become Web Page. Forced static mode; form has no directions or traffic controls despite description. | **Keep; P1 simplify.** Start with “Location map”; directions only after a real mode-specific implementation. |
| QR Code / 601 | Uses real `qrcode` generation in `TOUCH_POINT` → `QrCodeVariant`, not merely an icon. | Tile bypasses newer `QR_CODE` renderer. Old path uses container-query units; generation failure displays a decorative QR icon. Generated margin is one module: surrounding layout must still satisfy quiet-zone requirements. Old path was not decoded in this audit. | **Consolidate with Widgets; P1 migrate new additions.** New QR renderer passed six decoding tests. Keep old saved configurations readable. |
| Clock / 642 | CLOCK; timezone/12h/24h fields reach real renderer. | Free-text invalid IANA timezone reaches unguarded `Intl.DateTimeFormat` and can throw. Local-time default depends on the screen's configuration. | **Keep utility, move primary discovery to Widgets; P2 input guard.** Searchable timezone with tenant default. |
| Countdown / 662 | COUNTDOWN; date and label reach renderer. | Date-only UI lacks event time/timezone. Helper parses date at the executing device’s local midnight. Invalid saved input can produce invalid date/NaN output. | **Keep utility in Widgets; P2 repair.** Event time + timezone + expired state, not another app integration. |
| Weather / 704 | WEATHER; city/ZIP/coordinates and Fahrenheit/Celsius wired correctly. Metric is recognized by renderer; no units mismatch found. | Direct free Open-Meteo endpoint; commercial-service entitlement needs verification. City geocoder strips trailing state and requests first result; ambiguous cities can resolve incorrectly. No source timestamp in this tile’s setup. | **Keep utility + source service; P1 commercial prerequisite, P2 location confirmation.** Show selected city/state/coordinates before adding. |
| News / RSS / 745 | RSS_FEED → existing hook → server RSS/Atom parse/cache with safeFetch. Eight feed tests include RSS and ICS fixture rendering. | Feed response/freshness/empty/error states need visible setup checks; numeric item count has no field bounds. First failure currently uses sample content labeled “Connecting…”, inappropriate for production displays. Publisher rights/moderation remain operator requirements. | **Keep; P1 production fallback, P2 setup polish.** First-party school news by default. |
| Calendar / 773 | Current tile builds WEBPAGE; native CALENDAR + ICS fetch/parser already exist elsewhere and pass fixture tests. | Tile’s “ICS never fetches” comment is stale. Generic detector misses calendar. Embed HTML is not extracted. Secret ICS conversion drops token; malformed percent encoding throws, then form adds empty WEBPAGE. Static Google UI path is a poor signage default. | **Keep outcome, replace primary adapter; P1.** Native agenda from approved public ICS; optional qualified Google embed. Private calendars need secure source references, not URL-in-query reuse. |
| Facebook Page / 812 | Empty schema, `comingSoon`, placeholder SOCIAL_FEED; add disabled. | Not a working integration. Current blanket “not buildable in 2026” warning is not evidence of impossibility. | **Remove from main catalog.** Evaluate as a source inside a future moderated Social Wall, not a separate dead tile. |
| Instagram / 823 | Same unimplemented pattern; disabled Add verified in unit tests and Chromium. | Catalog conflates retirement of one API with all embedding; no implemented connector or rights/moderation workflow. Meta primary docs could not be retrieved during this audit. | **Remove from main catalog.** No promise that “pay an aggregator” alone finishes the integration. |
| Social Wall / 834 | Empty schema and build stub; names aggregators but does not integrate one. | No connector lifecycle, moderation, permissions, expiry, offline or content-removal behavior. | **Move to roadmap.** Potential flagship only after moderated ingestion and vendor qualification. |
| Google Reviews / 845 | Empty schema, comingSoon; no Places fetch/review rendering path supplied by this tile. | “Latest reviews” not guaranteed by a relevance-sorted Places response; data display has attribution/policy requirements. | **Remove from main catalog.** Retail/hospitality roadmap only; not a school default. |

## Priority findings with evidence and exact repair intent

### A01 — P1: a green “Add” button accepts broken sources

`AppConfigForm.tsx:146–190`: build errors become `{widgetType:'WEBPAGE', defaultConfig:{}}`; `canConfirm` only checks nonempty required strings. The URL-validity helper gates preview, not Add. `<input type="url">` is not a form submission validity guard here.

Reproduced in Jest and Chromium: `not a valid url` becomes `https://not a valid url`; malformed Calendar encoding adds an empty WEBPAGE. Fix with a discriminated parse/validation result and error-specific disabled states. Never turn parse errors into empty successful configurations. Validate again on save/API boundaries; UI validation is not security enforcement.

### A02 — P1: five “live” apps take the static web route

Registry marks Slides, PowerPoint, Sheets, Maps and Calendar `staticMode:true` (executed assertion). `WidgetRenderer.tsx:4469` maps that to noninteractive proxy mode; `proxy.controller.ts:313–322` removes scripts and event handlers. Even if a server browser executes the initial page, client timers, application state and interaction do not survive as a live provider app. An initial snapshot might render; it is not a functioning live slideshow/map/calendar certification.

Do not fix this by weakening the generic proxy sandbox or blindly changing every tile to interactive mode. Use separately qualified provider-specific cross-origin embedding or native data/rendered-media adapters. Preserve render capabilities, SSRF defenses and resource limits.

### A03 — P1: source normalizers disagree and destroy information

`url-transforms.ts` and `StreamingWidget.tsx:343–411` independently normalize video URLs. Tests demonstrate lost Vimeo hashes, broken playlist/query-order/channel paths, Sheets `gid` loss and Canva fragment errors. `detectApp` matches host-like text anywhere in a string rather than validated hostname. This is confirmed misclassification; this audit did not demonstrate an arbitrary-host sandbox escape.

Create one shared pure provider parser, validate HTTPS + exact allowed hostname/subdomain + supported path before interpreting IDs, preserve only meaningful approved parameters, and use it at add/edit/player boundaries. Add table-driven golden cases and round-trip tests. Do not regress rejection of private/network or unsupported streaming targets.

### A04 — P1: AI design drops the actual app

`AppConfigForm.tsx:250–274`: request contains app name/blurb, dimensions, vertical and count—not built source configuration. Response is added as a full-canvas EXTERNAL_HTML block. In a controlled Chromium run, entering a YouTube link never put that ID in the AI request or resulting zone. The mock service simply returned HTML; no external AI was called.

Temporarily hide this action for connected apps, or label it explicitly “Create a decorative layout” with no claim of connected content. Correct implementation lets AI propose constrained layout slots; deterministically place the existing validated app zone into the slot. Never send secret links/tokens to an AI prompt to “solve” the loss. Require review before canvas mutation.

### A05 — P1: school-sensitive source handling needs a product gate

`app-registry.ts:482–500` pairs “roster” with public publishing. Calendar transform accepts a secret ICS address and discards its private access token. Existing ICS endpoint accepts raw URLs on a public GET path and caches by URL: suitable for deliberately public feeds, not a new authenticated private-calendar connector.

Remove roster/student-record examples. Require explicit public-content acknowledgment for published links; show visibility before preview/add. Reject secret/private ICS from this public flow and offer a secure-source path only when implemented. Do not instruct teachers to publish student data or remove permissions to make a preview work. This is a security/product recommendation, not a legal compliance determination; T&Cs are not an access control.

### A06 — P1/P2: QR capability has drifted between two implementations

The Apps tile still uses the older touch QR even though `QrCodeWidget.tsx`/`qr-payload.ts` now support genuine QR payload modes with safer display constraints. Existing six image-decoding tests for the newer renderer passed. Its comment saying no earlier widget generated QR is inaccurate: the old Apps touch variant does generate QR. Correct both documentation and routing, preserve old payloads, test save/reopen and physical scan distance. No decorative fallback masquerading as a code.

### A07 — P2: finished layouts are additive, not a safe layout-selection flow

`AppConfigForm.tsx:212–234` calls add/update separately for each zone at absolute coordinates. `useBuilderStore.ts:523` pushes history for each add. It does not present a new-scene/replace choice. Source schema promises `{{url}}` substitution, but application merely spreads config. First selected zone can be the title strip instead of the app.

Build a dedicated atomic multi-zone action; simply wrapping existing addZone calls in a transaction is insufficient while addZone independently pushes history. Preview first, default to a new scene on nonempty canvases, require confirmation for replacement, preserve existing scene content and select the app zone. Drop unused placeholder syntax or implement typed source bindings, not string interpolation of secrets.

### A08 — P2: discovery filters and recommendations are unreliable signals

`listApps({includeComingSoon:false})` is a no-op (test reproduced). Panel filters APP_REGISTRY directly and sorts by friction, not suitability/readiness/industry. Social/Reviews categories lead to unavailable tiles. Concierge's module cache at `AppLibraryPanel.tsx:58,112–155` keys only by source URL; its effect omits tenant identity. A tenant switch using the same website may reuse earlier suggestions. Source-confirmed cache issue; no demonstrated confidential data disclosure.

One shared catalog selector must honor availability, industry, search, compatibility and permissions. Cache concierge by tenant + normalized website + version, clear on sign-out/tenant switch, cancel stale in-flight callbacks. Discovered is not connected, authorized or approved for publication.

### A09 — P2: configuration provenance is lost on add

The form writes only renderer-specific `defaultConfig`; it does not store `appId`, source schema version or an explicit nonsecret binding for reopening that integration’s form. The operator is sent to generic Properties. Preserve a backwards-compatible source descriptor; generic style editing remains separate from “Edit source”. Do not infer the provider later solely from a transformed URL.

### A10 — P1/P2: stale/failure behavior and readiness are not proven

Preview's 600 ms debounce finishing is treated as ready to render, not successful provider playback. Iframe load does not prove that a provider is showing content instead of an error, login, geo restriction or offline-channel message. RSS fixture tests confirm first-error sample rendering labeled “Connecting…”. Utilities also need invalid-timezone/date and confirmed-location handling.

Add truthful states: source parsed, access verified, preview ready, playback unverified/verified, stale, blocked, unsupported. On live displays use last approved good data with timestamp within policy TTL; otherwise a neutral branded unavailable state—not fabricated sample events/news. Avoid rejecting sources solely because a server-side HEAD request fails; use each provider's supported checks and explicit unknown states.

### A11 — commercial prerequisite: weather service

`weather-api.ts:126` calls the free `api.open-meteo.com` endpoint directly. Official pricing distinguishes a noncommercial free service from a commercial subscription; data licensing and hosted-service entitlement are different questions. Verify the actual VenueOS agreement or choose a licensed/self-hosted service before commercial rollout. This audit did not inspect a billing account. Confirmed Celsius wiring should not be “fixed” unnecessarily.

### A12 — P2: visual density obscures the task

The screenshot’s large gray icon slabs convey a provider, not an output. Two inputs, a concierge block and ten category choices precede the useful cards. Actual code uses tiny 9–11px labels in several places. Existing semantic buttons, category pressed states and card→form focus restoration are useful foundations; keep them. Replace cards and controls using the handoff, rather than changing icon colors alone.

## Official-source checks

Checked September 12, 2026. These establish provider requirements, not successful VenueOS integration:

- YouTube distinguishes video and playlist embed configuration; autoplay has viewer-data implications. [Player parameters](https://developers.google.com/youtube/player_parameters).
- Vimeo unlisted embeds require the privacy-hash parameter and permitted domains. [Missing-video diagnosis](https://help.vimeo.com/hc/en-us/articles/12426470858001-Embedded-player-displays-This-video-does-not-exist-message).
- Twitch requires declared parent domain(s), a minimum 400×300 player, and autoplay conditions. [Embedding video](https://dev.twitch.tv/docs/embed/video-and-clips/).
- Google publishing can expose sensitive information; embedding is not a permission bypass. [Publish Docs, Sheets and Slides](https://support.google.com/docs/answer/183965?hl=en-GB), [embed Calendar](https://support.google.com/calendar/answer/41207?hl=en).
- Office embedding uses the provider's embed workflow; Canva offers a distinct embed facility. [Microsoft presentation embedding](https://support.microsoft.com/en-US/PowerPoint/embed-a-presentation-in-a-web-page-or-blog), [Canva embeds](https://www.canva.com/embeds/).
- Maps offers distinct embed modes with mode-specific parameters; Places reviews/attribution need a real implementation, not the existing empty tile. [Maps embed](https://developers.google.com/maps/documentation/embed/embedding-map), [Places schema](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places), [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).
- Weather free-service versus commercial subscription conditions: [Open-Meteo pricing](https://open-meteo.com/en/pricing).
- QR requires four-module clear margins around the symbol; verify final rendered spacing, not merely source image settings. [DENSO QR area guidance](https://www.qrcode.com/en/howto/code.html).
- Meta's primary documentation pages returned access errors here. Therefore this report does not claim that all Facebook/Instagram embeddings are discontinued or that an aggregator is the only technical option. Retiring the four main-catalog stubs is justified by their actual code, independently of provider feasibility.

## Remaining release evidence — not done by this audit

For every retained provider, use owned nonsensitive fixtures and record build SHA, source permission state, player target, browser/OS, screenshot, console/network outcome and elapsed playback. Exercise editor setup → add → save → reopen → preview → paired staging display → source update → source revoked → network loss/recovery. Run at least a 60-minute functional loop and 24-hour soak for live sources, including cold restart and credential/capability renewal. Qualify current desktop browsers separately from actual Taurus Chromium 83–87. A screenshot or successful iframe load alone is not a playback pass.

No broad penetration test was performed, and neither this audit nor the design constitutes a declaration of FERPA/COPPA/state-law compliance.
