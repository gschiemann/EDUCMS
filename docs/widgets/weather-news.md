# Forecast and rotating headlines

Use the existing widget picker and Properties panel:

- **Weather → Multi-day Forecast**: location (U.S. city, ZIP, or the existing Use my location button), units, and 2–5 days. Cards reflow inside the widget when its size/orientation changes. Existing current-weather variants remain available. Changing Forecast days on an existing weather zone selects the outlook variant.
- **News Feed → Rotating Headlines**: select any combination of the included Global Voices and NASA sources, edit the heading, and set seconds per headline (5–120). An optional additional RSS URL reuses the existing feed field. Only add feeds whose terms permit your use. No paid headline subscription or API key is needed for the included sources.

All controls use the template maker's existing SelectField, ToggleField, NumField, TextField, SmartLocationField and variant picker. Both renderers reuse useElementSize; polling reuses usePolledFeed/useLiveRssFeed and the SSRF-safe RSS backend. No new widget enum, database model, modal editor or separate settings application.

## Data flow and freshness

Forecast: native Properties → GET /api/v1/feeds/forecast → cached location lookup → NWS point/grid forecast → actual day/night pairs → responsive cards. The provider currently covers U.S. locations. A night-only first period never becomes a made-up daytime high. Unsupported locations and provider outages show an unavailable state on real screens. Builder samples are marked SAMPLE. Refreshes every 15 minutes, retries failed requests after one minute, and stops retaining a failed forecast after an hour.

Geocoding uses Nominatim for city/ZIP searches, triggered only after the existing location input commits on blur/Enter. Coordinates bypass it. Results cache for 30 days, with an application-wide Redis NX lease limiting new searches to less than one per second. New searches fail closed without Redis; cached/coordinate forecasts remain available. WEATHER_GEOCODER_URL can switch the endpoint without a software update. OpenStreetMap attribution appears for geocoded locations. This is weather-only lookup, not a generic address-search API. [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

Headlines: source switches → existing GET /api/v1/feeds/rss → SSRF-safe fetch/parse → five-minute shared cache → round-robin mix → saved rotation. Duplicate links, unsafe links, missing dates and stories older than seven days are omitted. Global Voices entries require bylines; original links, author and CC BY license credit remain visible. Failed feeds retain data for at most an hour; unavailable feeds never turn into fabricated live headlines. Successful feeds continue when another source fails. Changing a source URL clears the old data immediately. Hidden tabs pause polling/rotation and poll when visible again.

The shared upstream rate limiter now runs on cache misses, with RSS in-flight coalescing. A 100-screen burst shares one source request; cache hits do not consume the origin-fetch budget. Per-IP throttles, SSRF checks, bounded payloads and provider timeouts remain enforced. Routes are read-only and kiosk-visible, like the existing RSS route; no privileged writes or new secrets.

## Resize fix

All canvas move/resize/rotate gestures use primary-button pointer capture on the stable canvas. A no-buttons move ends a missed release before changing geometry. Pointer up/cancel, lost capture, window blur, hidden document and Escape end the gesture/history transaction. Other pointers and right-button presses cannot start it. Resize handles disable native touch panning. This fixes the shared canvas, including weather over sandboxed directory iframes.

## Sources

- [NWS API documentation](https://www.weather.gov/documentation/services-web-api): free open data for any purpose, application User-Agent required.
- [NASA RSS feeds](https://www.nasa.gov/rss-feeds/) and [media-use guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/): factual editorial headline display, source credit, no logos/imagery or endorsement claims.
- [Global Voices republication policy](https://globalvoices.org/about/global-voices-attribution-policy/): attributed commercial reuse under CC BY; original article link, byline and license link retained. No third-party article photos are republished.

## Verification

Local: 97 backend feed/forecast/security/cache tests; 24 widget/editor/registry unit tests; six Chromium/WebKit builder flows (including missed pointer release and save/reopen in portrait/landscape); 20 native-4K actual-provider render checks (2–5 days and rotating headlines in both orientations/engines). A real Honolulu city-name request returned five metric days through the new controller/provider boundary. Type/build, Taurus and inset checks pass. Provider fixtures and browser fixtures are separate from the actual-provider evidence. Production verification is recorded in the release report after deployment.

Bundle verification: production gates the developer-only widget lab on the server before importing its client renderer. The feature build totals 19.34 MB versus the previous 19.65 MB; the existing bundle ceiling is unchanged. Widget variants share the existing family loader/dispatcher.
