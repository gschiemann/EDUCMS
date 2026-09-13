# Apps: outcome-first redesign and developer handoff

Proposal only. Pair with AUDIT.md; do not mark an app “Ready” merely because this design includes its card. Ship correctness before marketing polish. Keep the user's existing templates and unrelated work intact.

## 1. Product model

**Widgets** create native on-screen content. **Apps** bring content from another source. **Layouts** arrange either. A provider, a renderer, a saved connection and a complete layout are different things; the interface must not conflate them.

Retain the familiar “Apps” tab label. Use heading **Bring your content to the screen**. Under it show one input, **Search apps or paste a link**. No separate paste box and search box, no permanent AI form above the catalog, no ten-chip taxonomy wall.

Primary browsing: **Recommended / All sources / Your connections**. Industry selector **For: Schools** belongs next to the heading, defaulting from tenant settings and always changeable. Selection influences ordering, not authorization or access. Search crosses all available sources so an industry filter never hides an exact provider match.

Recommended shows at most eight high-utility, qualified external sources. Show native utilities in a small **Need a clock, QR code or weather? Open Widgets** section, with four text shortcuts. Four unfinished integrations go in a separate collapsed **Roadmap**, not mixed among usable results. “No connections yet” is a normal empty state; no fabricated connected badges.

### Industry defaults (proposed, not observed usage data)

| Industry | Preferred order / emphasis |
|---|---|
| Schools / K–12 | Slides, Calendar, Canva, School news (RSS), YouTube, Sheets, Maps, Vimeo. Use first-party public announcements and approved public data. |
| Higher education | Calendar, Slides, Canva, RSS, YouTube, Maps, Sheets, Vimeo; Twitch only in esports contexts. |
| Corporate | PowerPoint, Calendar, Sheets, Slides, Canva, Vimeo, RSS, Maps; protected sources only with a real secure connector. |
| Retail | Sheets, Canva, Slides, Vimeo, YouTube, Maps; future Reviews only after delivery. |
| Restaurants | Sheets/menu data, Canva, Slides, Maps, Vimeo; do not present an arbitrary sheet as the POS integration. |
| Hospitality | Calendar/events, Maps, Canva, Slides, Vimeo, RSS; utility Weather shortcut. |
| Healthcare | Approved public Calendar, Slides, Canva, Maps, RSS; no patient-facing private records in public embeds. |
| Worship | YouTube, Calendar, Slides, Canva, Vimeo, RSS, Maps; QR shortcut for giving through an existing approved destination. |
| Venues / sports | YouTube, Calendar, Canva, Vimeo, Maps, Slides, RSS; Twitch optional esports filter. |

Do not market any ordering as “most popular” until there is consent-aware usage evidence. Respect tenant app allowlists and role restrictions before ranking.

## 2. Card design — content first, logo second

At a 640–736px panel use two columns; below 520px use one. At the actual narrower builder sidebar also use one column rather than shrinking type. Cards should show recognizable output in their top half: an agenda, news headline, menu table, slide, video frame or location card. Never a giant gray rectangle containing a generic icon.

**Card anatomy:** small provider mark/name; styled outcome preview; outcome title; one sentence describing what appears on screen; honest requirement badge; explicit action. The entire card is one native button with an accessible name such as “Set up Google Slides — published deck required”. The visual footer action is part of that button, not a nested button. Put secondary actions in the setup view, not inside the card button.

Brand marks must be approved assets, used according to provider rules; until available use clear text wordmarks. They occupy about 16–24px, not the whole preview. The content preview remains the visual identity.

Use CMS indigo for selection/actions, slate-neutral chrome, 14–16px body, 16–18px card titles, 12px minimum secondary copy and 44px product touch targets. Content thumbnails can be colorful because they preview content, not arbitrary category colors. Strong selected/focus outline, keyboard focus, textual status and readable contrast. No essential hover-only affordance. Reduced-motion means static examples. Never fetch 11 third-party embeds just to display the catalog.

Examples must be local, nonsensitive, clearly marked **Example**, and approved for preview. Connected-source thumbnails require tenant-scoped cache/storage and expiry; never put user content in a public global thumbnail cache. Do not generate a new AI image each time the panel opens.

### All 19 entries: exact proposed preview and action

| Current ID | Outcome card / preview | Requirement badge | Primary action and what it does |
|---|---|---|---|
| youtube | **Video & live broadcast** — branded “Morning announcements” video frame, captions strip and subtle play mark. | Public / permitted video · Internet | **Choose video** → source form; choose Video / Playlist / Live only when each mode is qualified. Never autoplay catalog previews. |
| vimeo | **Premium video** — cinematic event frame with title and duration. | Embed permission required | **Choose Vimeo video** → public/unlisted source form; preserve privacy hash without displaying/logging it unnecessarily. |
| twitch | **Live esports stream** — match broadcast frame with offline alternate. | Advanced · Internet | **Set up stream** → channel, approved parent/target check, minimum dimensions and offline fallback. No chat in school default. |
| google-slides | **Auto-playing slides** — two slide previews with “1 / 6 · every 8s”. | Published deck required | **Choose slide deck** → paste published/embed link, validate, choose interval/loop and preview rotation. |
| powerpoint-onedrive | **Presentation board** — editorial meeting/title slide. | Supported embed or import | **Choose presentation** → choose official embed or route into the existing supported import workflow. Do not promise a PowerPoint upload converter unless one exists and passes tests. |
| canva | **Designed in Canva** — vibrant open-house poster with hierarchy and visual shapes. | Published design required | **Choose Canva design** → embed link/snippet or existing media/PDF import fallback. Source editing stays in Canva; CMS edits frame/layout. |
| google-sheets | **Live data board** — readable public menu table with last-updated line, not a whole desktop spreadsheet. | Public data only, unless secure connector exists | **Choose spreadsheet** → select published source, tab/range, row/column mapping, table/theme and refresh. The designed-data-board adapter is new work, not existing behavior. |
| web-url | **Website embed** — compact branded webpage screenshot with source hostname. | Advanced · Compatibility varies | **Check website** → validate target, choose supported mode, inspect permission/compatibility result; not “add any site”. |
| google-maps | **Location map** — actual approved map preview plus location name and directions QR; no stock globe. | Published embed / supported map | **Choose location** → address candidate selection or supported embed. Show exact resolved place before Add. Directions QR is optional and generates an approved link, not an unimplemented live directions layer. |
| qr-code | **Scan to act** — genuine QR and meaningful caption, e.g. “Open-house details”. | Native widget · No account | **Create QR code** → existing QR_CODE settings/payload builder in Widgets, prefilled from a source only on explicit action. Never a decorative QR placeholder. |
| clock | **Time & date** — actual clock-face or typographic time/date preview. | Native widget | **Add clock** → Widgets preset with tenant timezone, selected for editing. If timezone unknown, ask in setup before Add. |
| countdown | **Event countdown** — large days/hours with named event and deadline. | Native widget | **Set countdown** → date/time/timezone and expired-state settings in Widgets. |
| weather | **Local weather** — current-condition scene, temperature and confirmed city. | Weather service required | **Choose location** → city/ZIP/coordinates, confirm resolved match, units and forecast view; existing renderer, not new parallel implementation. |
| news-rss | **News & announcements** — editorial headline, school/source label, date and progress position. | Public RSS / Atom feed | **Choose news feed** → feed validation, items preview, limit 1–20 (proposed), display cadence and failure policy. |
| calendar | **Agenda & events** — Today / Next rows with time, place and event names. | Public calendar, or secure connector | **Choose calendar** → public ICS native agenda by default; optional qualified Google embed. Secret links blocked in the public-source flow. |
| facebook-page | Roadmap only: source label beneath a potential **Moderated social wall** concept. | Not available | **View requirements** → explains unimplemented connector and approval/moderation requirements. No disabled setup dead end. |
| instagram | Same consolidated social-wall concept; never imply Basic Display retirement proves all embeds impossible. | Not available | **View requirements** → professional-account/API/vendor qualification, content rights and moderation; no promised delivery date. |
| social-wall | Roadmap concept: approved post queue → polished on-screen mosaic. | Not available | **View requirements** → planned moderated wall scope; optional feedback submission only if a real backend exists. |
| google-reviews | Roadmap: sourced review quotation, attribution and rating; retail/hospitality context. | Not available | **View requirements** → supported review source, attribution, refresh/deletion rules and approval workflow; never fake a connection. |

## 3. Setup flow and all shared buttons

1. **Choose source.** Card or paste detection opens a provider-specific form, preserving search, industry and scroll position for Back. Never add unconfigured content merely because the operator clicked a card.
2. **Validate input.** Parse locally; show field errors with accessible association. Confirm supported type and provider host. Label source visibility and Internet dependence before any third-party request. Load previews deliberately; avoid external requests on each keystroke.
3. **Check source.** Explicit check runs provider-aware access validation with timeouts and typed failure reasons. Never call “Connected” just because the string parses. For private data, require the implemented secure connection—not a request to publish publicly.
4. **Preview output.** Same source binding and rendering adapter as the player. Toggle **Content / On screen**: content check versus actual board-size fit. Respect tenant brand and target aspect ratio. Keep Example separate from Your source.
5. **Add deliberately.** Choose a single block, or preview a complete layout in a new scene. Add only a structurally valid, permitted source; if remote playback cannot be verified, allow **Add as draft** with an explicit unverified state, not “Ready to publish”. Draft can be configured during outage; publishing remains gated.

| Control | Exact behavior |
|---|---|
| Search apps or paste a link | Search names, aliases and outcomes. If a recognized link/snippet is pasted, show provider match + **Set up source**; never silently redirect. Unknown input yields a precise unsupported/invalid state, not an automatic guarantee of Web Page support. |
| Recommended | Qualified sources ranked for current industry. Not based on friction-tier marketing. |
| All sources | All implemented/allowed sources; optional “Show advanced” reveals Twitch/Web Page. Unimplemented entries remain outside results. |
| Your connections | Tenant-scoped reusable sources only. Show empty state if none. Authentication expiration requires **Reconnect**, not Add. |
| Industry selector | Changes recommendations only; exact search still discovers other industries. Show explicit label; do not silently rewrite tenant profile. |
| Suggested source | Small dismissible row below recommendations: “Found on your website — not verified”. **Review source** opens setup; never immediately trusts/adds scraped content. |
| Back to Apps | Preserves catalog context and returns focus to invoking card. Warn only if meaningful unsaved setup work would be lost. |
| Open publishing instructions | Opens provider help with clear provider name, safe new-tab attributes. Not “Open it now”. |
| Check source | Validates currently entered source version. While pending: **Checking…**, no duplicate requests; cancellation/stale-response protection. |
| Use example | Loads clearly labeled sample content, never replaces a saved real connection or claims provider access. Publishing sample content requires deliberate acknowledgment. |
| Retry check | Retries access validation; bounded retries and actionable error reason. No infinite spinner. |
| Open source | Opens normalized public source; do not expose credential-bearing URLs. Disabled for unauthorized roles. |
| Preview on screen | Shows a local player-mode preview at chosen target size, not a live screen broadcast. Label target and Internet requirement. |
| Add to canvas | One validated source block, deterministic placement, selected; one undo operation; no publishing. Label specifically, e.g. **Add agenda to canvas**. |
| Add as draft | Only for structurally valid, authorized but not remotely verified sources. Persist warning; block Ready/Publish until target-specific criteria met. |
| Try a layout | Preview full composition. No mutation on thumbnail click. Offer **Add as new scene** by default on nonempty canvas. |
| Replace this scene | Destructive branch: explicit confirmation identifies scene and affected zones; atomic undo; never default. |
| Design around this content | Available only after source-binding-preserving AI flow exists. AI returns layout constraints, not a replacement for user content. User reviews before applying. |
| Edit source | Reopens correct app setup with source schema/version, not just generic Properties. Saves new binding without unexpectedly resetting style. |
| Disconnect / remove source | Shows affected templates/screens; permission-checked, explicit confirmation, audit record; does not silently delete cached user assets. |
| Test on a display | Separate later action with staging target selection and explicit confirmation. Must not bypass publish approvals or emergency precedence. Never run automatically from a card. |

### State contract

`empty → parsing → invalid | needs_access | ready_to_check → checking → preview_ready | blocked | unavailable | unverified`

Source changes invalidate prior verification. User input may be saved as a draft only if structurally valid and permitted. `preview_ready` is not `playback_verified`. Verification is bound to source revision + adapter version + target profile; do not treat a provider's generic `onload` as success. Show last successful check timestamp and what was actually tested. On a private/secret source, redact URLs in messages and telemetry.

## 4. Implementation plan — exact boundaries

### Phase 1: stop incorrect outcomes (release blockers)

Owner: integrations/frontend developer. Files: `components/apps/{app-registry,url-transforms,AppConfigForm,AppLibraryPanel}.tsx/ts`, relevant tests; shared provider parser plus streaming consumer. Read actual paths before editing.

- Replace boolean-only required validation with structured `ParseResult`: success with canonical provider source; or typed field error. Block Add on parsing/build failure. Enforce sensible numeric ranges and timezone/date validation.
- Fix YouTube playlist/query-order/channel handling; require real resolved channel identity for live, otherwise request a direct live-video link. Preserve Vimeo privacy hash through both paths. Parse iframe snippets with a bounded HTML parser/extractor; allow only the src of one recognized HTTPS iframe, never execute pasted HTML. Decode HTML entities safely. Guard malformed percent escapes. Preserve Sheets tab selection and relevant range settings. Separate unsupported Maps share/short links from address text.
- One shared selector honors `includeComingSoon:false`; main catalog omits four stubs and empty categories. Preserve lookup by old IDs for backwards compatibility.
- Remove misleading copy immediately: “any website”, blanket “instant/no login”, roster example, universal social impossibility and current AI connected-content promise.
- Fix concierge tenant key and stale-response behavior. Keep third-party discovery suggestions untrusted.
- For static provider-backed apps, mark compatibility limitations or gate new additions until a supported adapter passes tests. Do not silently change old saved boards to a different render mode.

### Phase 2: establish a source/renderer contract

Suggested names are new code, not existing files:

```ts
type AppAvailability = 'available' | 'beta' | 'roadmap' | 'deprecated';
type SourceMode = 'native-data' | 'official-embed' | 'approved-media' | 'website-proxy';
type ParseResult =
  | { ok: true; source: PublicSourceDescriptor; warnings: string[] }
  | { ok: false; code: string; field: string; message: string };

// A source binding is not an OAuth token or a secret URL.
type AppBinding = {
  appId: string;
  schemaVersion: number;
  mode: SourceMode;
  sourceRef?: string;          // tenant-scoped opaque reference for protected sources
  publicSource?: PublicSourceDescriptor;
  verification?: {
    sourceRevision: string;
    adapterVersion: string;
    targetProfile: string;
    checkedAt: string;
    result: 'preview-ready' | 'playback-verified' | 'unverified';
  };
};
```

Define PublicSourceDescriptor as a provider-specific discriminated union, not an arbitrary `Record<string, any>`. Keep presentation settings independent of source identity. Store bindings alongside, or in a namespaced portion of, existing zone configuration with versioned validation; do not break legacy consumers. Preserve old renderer payload shape while migrating new additions. The exact API/schema change must follow existing project conventions and tenant-isolation gates.

Adapter responsibilities: `parseInput`, `validateConfig`, `checkAccess`, `buildZone`, `capabilities`, `redactForLogs`, plus lifecycle handling for stale/revoked sources. Give each provider allowed inputs, host/path restrictions, privacy requirements, minimum output size, supported targets and default fallback. No generic `worksEverywhere` flag.

### Phase 3: use the right render path

| Source family | Implementation direction | Required tests before availability |
|---|---|---|
| Video | Shared pure normalized source → existing StreamingWidget; provider-specific official player. | Video/playlist/live identities, Vimeo hash, parent domains, error/offline/ads/age/geo behavior, muted cold autoplay, captions, source revocation. |
| Slides / presentations | Qualified official cross-origin iframe OR authorized import into approved media with owned timing. Preserve source updates only where implemented. | More than one slide actually advances; interval/loop work; private/revoked source blocked; font/video support honestly labeled; offline fallback. |
| Canva | Official published embed or existing approved export/import route; preserve design identity. | View/edit/snippet/fragment/permissions cases; iframe origin restrictions; changes propagate only in embed mode; exported media clearly labeled snapshot. |
| Sheets | Public HTML embed compatibility fix first. New designed-data-board adapter reads approved public data server-side and maps selected columns/rows into native table/menu. | Selected tab/range preserved; data types/empty/malformed rows, capped rows/bytes, formula/HTML treated as data, correct refresh and timestamp. Protected Sheets is separate scoped auth work. |
| Calendar | Reuse CALENDAR + existing ICS parser/hook for deliberately public calendars. Keep approved Google embed optional. | All-day, recurring, DST, timezone conversion, cancellation, duplicate UID, source update/revoke and no sample data on live failure. |
| Maps | Supported official embed + resolved location; limit first release to place view. | Address disambiguation, exact place, directions-link QR, target compatibility, attribution, key restrictions if API used. Browser map keys are not private secrets; restrict by referrer/API and do not leak server credentials. |
| Generic website | Preserve hardened generic proxy with mode-specific limits; do not borrow privileged provider iframe permissions. | Unsupported/login/CSP/challenge outcomes, resource caps, redirects/SSRF, script boundaries, timeout and recovery. No promises for paid/DRM/interactive sites without qualification. |
| Native utilities | Reuse existing widget components and property editors; route new QR additions to QR_CODE. | QR decode/save/reopen/physical scans, timezone validation, deadline/timezone accuracy, weather location confirmation/entitlement, stale state. |

A dedicated cross-origin provider iframe may use narrowly reviewed permissions on a strict host/path allowlist. Never add `allow-same-origin` to the same-origin arbitrary-content proxy to make a provider work. Keep untrusted scripts off authenticated API/admin origins. Do not bypass X-Frame-Options, login, consent or provider terms by rebranding a proxy as an official integration.

### Phase 4: deliver the interface

Implement `AppPreviewCard`, `AppSourceSetup`, `SourceStatus`, and a shared catalog selector as focused components, following existing UI conventions. Static preview assets render immediately; load a real preview only after selection/check. Use the same source adapter as playback. Industry sorting is data-driven and testable. Widgets utilities route to existing setup, not cloned forms. Preserve search/focus on Back, keyboard and screen-reader status semantics, mobile sizing and actual builder sidebar behavior.

Replace the multi-zone loop with an atomic store operation that creates one history snapshot, assigns active scene explicitly, preserves z-order, selects the app zone and supports one-step undo/redo. Add dedicated tests for blank canvas, existing scene, nondefault aspect ratio and cancellation. AI layout output is schema-validated, clipped to bounds and never permitted to supply a replacement source/token.

### Phase 5: secure lifecycle and rollout

- Protected sources, if added, need tenant-scoped authorization, encrypted credentials, least-privilege provider scopes, refresh/revoke, consumer enumeration, redaction and immutable audit rows for privileged actions. Use opaque source references and device-scoped render authorization. Do not reuse unauthenticated raw-URL feed routes for confidential feeds.
- Public-source checks retain safeFetch DNS/connect-time private-network rejection, redirect revalidation, timeout/byte caps and global/per-host rate limits. Validate every resolved short-link redirect. Avoid URL credentials in logs, analytics or screenshots.
- Source-check endpoints are an abuse surface: require appropriate session/device scope, rate limits and bounded work. Do not start costly browser rendering automatically for every pasted character.
- Live player failure must not display demo content. Keep approved cached content only within configured staleness/privacy policy; revoked sources require invalidation. Never display a fabricated event, price or announcement as current.
- New app defaults behind a feature flag. First migrate new additions; audit saved legacy configs before offering opt-in migration. Never silently delete historical zones or reset style. Preserve emergency overlays, signing, device credentials and polling fallback.
- Measure setup-start → valid-source → preview → add → successful staged playback; collect error codes and adapter/target versions, not raw URLs or student content. Use this evidence to tune recommendations.
- Run targeted type checks, unit/integration tests, accessibility/mobile/cross-browser/tenant gates, then review diff and full CI before deployment. No deployment is included in this proposal.

## 5. Definition of done

- All 19 old IDs have an explicit disposition; four stubs no longer occupy the usable catalog and are not broken saved-template migrations.
- Every visible card depicts a real outcome, has meaningful text and an honest requirement; no unused placeholder icons, dead categories or made-up “connected” states.
- All four browser evidence cases are inverted into regression acceptance tests: invalid input cannot add; build failures show errors; AI preserves source binding; unavailable remains nonaddable.
- Every repro in the evidence suite becomes a desired-behavior test, rather than retaining assertions that expect the defect. All 15 form paths have provider-specific valid AND invalid fixtures.
- Source identity survives Add → Save → Reopen → Edit source → Save → Player. Style changes do not reset identity; source changes invalidate old verification.
- Each implemented button has loading/error/cancel/keyboard behavior and a test. Empty data, expired auth, revoked source, unsupported device and offline states are intentional designs.
- Three canvas sizes (landscape, portrait, narrow ribbon), 320/390px mobile and actual sidebar width reviewed. Desktop visuals are not limited by Taurus; code delivered to Taurus follows its separate compatibility rules.
- QR generation is decoded in tests and scanned at real size/distance; advanced sources are tested on named devices, not assumed safe because they render in a desktop iframe.
- Provider release matrix, 60-minute loop and 24-hour soak documented as specified in AUDIT.md. Only then advertise that provider/target combination as supported.

## 6. Handoff instruction to the AI developer

Read CLAUDE.md, AUDIT.md and this file. Work in an isolated worktree. First implement Phase 1 and provider-parser tests without changing security gates or saved-board behavior. Show the diff and verification results. Then port the approved card/setup design, wire real adapters, and test the full source-to-staging-player flow. Do not ship placeholder connectors, delete old widget types, claim an integration works from unit tests alone, or call the Apps AI path finished unless the user’s actual source survives the generated layout.
