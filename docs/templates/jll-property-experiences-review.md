# JLL signage and touch experiences

User approved all three overview directions on October 4, 2026, then requested image carousels, optional video and matching touch experiences.

## Contents

- Three signage layouts: Architectural, Hospitality, Editorial.
- Three touch layouts: Guided property tour, Immersive property showcase, Leasing information hub.
- Each has a JLL and generic version, each supporting landscape and portrait: 12 HTML templates / 24 formats.
- Seven touch pages: overview, amenities, plans, location, details, contact, gallery. Three amenity selections and eight floor-plan sheets, covering all published levels for the JLL example. Every section is one tap away in an icon-and-label navigation dock. All eight floor buttons stay visible, and Back preserves the selected floor and zoom. The gallery has manual previous/next and direct image selection. Photo hero carousels autoplay by default.

## Existing CMS tool compatibility

Native image galleries: replace/reorder photos through the Image picker or `media.<slot>.slides`; configure `carousel.intervalSeconds`, autoplay and transition, plus per-slot fit/crop/mode. Defaults rotate every seven seconds.

Video: the existing Video picker discovers `property.film`. Supply a browser-playable MP4/WebM and optionally replace `property.film.poster` using the image picker. Video is silent, inline and looping by default. The `video.autoplay`, `video.loop`, `media.property.film.fit` and `media.property.film.position` fields remain editable. Missing, blocked or failed video leaves photography visible. Videos pause on hidden touch pages. No real property film is bundled; the automated playback fixture is excluded from this deliverable.

All visible copy exposes data-field and the V14 click-to-edit shim. Colors, fonts and scale use existing theme fields. Text styles and saved positions use the native layout adapter. Plans use contained image slots. QR is generated from the editable `contact.url` and accepts only HTTP/HTTPS. `tour.startPage` controls the initial page; `tour.idleSeconds` defaults to 120 and resets navigation, floors, gallery and zoom. The suggested template idleResetMs is 120000 for touch records.

## Content provenance

JLL photos/renderings, published plans and property facts: https://property.jll.co.uk/listings/1-liverpool-street (reviewed October 3–4, 2026). Watermarks are intact. Floor plates are presented as published plans, without implying all floors are available. Available space is a reviewed snapshot; confirm live leasing facts with JLL.

Generic branding, property details and concept plans are illustrative. Its stock photography is independent of JLL, from the existing licensed/reference asset collection and https://images.unsplash.com/photo-1486406146926-c627a92ad1ab. The font and QR dependency licenses remain in the shared assets directory.

## Delivery state

Local, reviewable EXTERNAL_HTML templates. No live tenant, database, deployment or device was changed. The 24-format review manifest includes source hashes, zone config, orientations and touch flags. It is separate from the earlier 32-record collection installer; do not pass it to that installer. JLL versions must remain customer-scoped. Generic versions can be registered as Corporate / Touch Kiosk presets after touch design review.

The rest of the original collection remains in the first review. This update covers the three approved overview directions and three new matching touch experiences.

## Verification

See verification for actual Chromium/WebKit captures and results. Checks include information text sizes, overlaps, 720p touch targets, direct navigation, Back history, amenity/floor/gallery selection, plan zoom and drag, idle reset, QR validation, hidden-page CMS editing, saved text positions, edit/preview transitions, carousel playback, MP4 playback and photo fallback. Final physical display sizing still depends on screen dimensions and viewing distance.

Run Launch Preview.command or serve this folder on localhost port 8929. Open full-screen preview retains the active touch page.
