# Widget data audit — free sources and honest editing

The scope is the existing widget library, not a new set of mock widgets. The registry contains 727 design variants. Most are authored content or visual layouts, not independent third-party data services. The full registry export is in the review package; registration integrity is checked separately from functional feed tests.

## Corrected data paths

| Family | Actual source / behavior | Operator setup |
| --- | --- | --- |
| Newsroom | GDELT headline metadata. Short, shared rolling-index responses while a paced search refreshes the edition. Six-hour metadata retention prevents the upstream 15-minute window from wiping an edition. Search and client reject headlines indexed more than one day ago. Selected publishers and local-city filters remain intact. | Choose coverage and optionally a city/ZIP and publishers. No API key. Empty local coverage is disclosed. |
| Weather outlook | Existing National Weather Service forecast endpoint. Each day is a centered unit; constrained zones rotate readable groups instead of making text illegible. | City/ZIP, 2–5 days, look, background/text/accent. Native toolbar formats the selected text area. |
| Daily exchange rates | ECB daily reference XML, fetched server-side, shared for one hour, converted mathematically to the selected base. The published business-day date is shown. No invented intraday changes. Data older than seven days is refused. | Base currency. Existing entered pairs remain manual. Free source credit is visible both in discovery/editor copy and on the board. |
| Calendar designs | All 31 registered calendar looks use the existing ICS transport. The legacy themed path is covered too. A failed or empty calendar cannot fall through to a design’s sample events. | Paste your authorized ICS URL, or use the existing event editor. Entered events remain available. |
| RSS / rotating headlines | Existing server-side RSS fetcher, selected free sources or an operator-supplied authorized feed. Last-good RSS content is bounded to one hour; calendar transport to 24 hours. | Select sources or provide a feed URL. |
| Clocks / countdowns | Device clock and configured time zone / target date, not a remote commercial feed. | Existing native time and date controls. |
| Social posts / venue sports | Existing connected accounts or bound game/console data. These are actual integrations, not generic public datasets. | Existing Apps / game binding setup. No new provider was provisioned by this change. |

## Boards without an automatic feed

Flight information, departures, transit arrivals, traffic-condition tiles, parking counts, stock quotes, crypto prices, air-quality readings and entered scores do not acquire a live source by having a polished design. They are visibly described as manually updated in discovery and in the native editor, and carry that label on the rendered board. Row editors have been restored where the registry previously exposed no fields for the underlying rows. The old traffic tile design is called Road Conditions Board because it contains no camera imagery.

Google Reviews uses Google Places API (New), not a connected Business Profile account. Its description now states the actual dependency and Google billing. No key or billing account was created or enabled. This is outside the free-only rollout.

No flight data provider, market-data subscription, paid map service, scraping proxy, borrowed API key, or unlicensed feed was added. Existing entered content is preserved.

## Editing contract

- Keep Content and Appearance in the native template builder. Reuse the row editor, location field, color picker, selectors, and floating text toolbar.
- Weather and Newsroom each have one typography workflow: select the text area and use the existing floating toolbar. Duplicate percentage text-size sliders and competing whole-widget font controls are removed.
- Weather and news expose background, text and accent first; detailed colors/opacity are secondary. Other v2 designs keep their frequent controls first and collapse the remaining appearance controls.
- Newsroom edition lines, publisher labels, dates, section headings, status and footer participate in the existing toolbar style schema.
- An old whole-widget font-size override is cleared when a weather/news field’s size is explicitly edited, so it cannot defeat the selected field.
- Live headline wording and forecast values remain supplied by their sources. Headings and authored labels are editable; manual boards remain available for entered content.

## Free-only coverage limits and remaining work

A free public feed is not a guarantee of coverage in every city. GDELT may have no recent local story for a given ZIP. Empty editions retry promptly and remain labelled; national stories are never silently reclassified as local.

Legacy single-day/current-weather and embedded weather headers still use Open-Meteo. Its hosted free API is explicitly non-commercial ([provider pricing](https://open-meteo.com/en/pricing)); those paths require a free commercial-use replacement before this wider audit can be called complete. The NWS outlook in this change does not depend on Open-Meteo. No commercial weather subscription is authorized.

The nationwide traffic requirement remains open. California public incidents/camera snapshots were researched, but they do not cover the whole United States. TomTom advertises monthly free allowances, including 2,500 incident-detail requests and 20,000 flow-segment requests, but it still needs a free account/key and verified display terms. No paid fallback or automatic overage is authorized. A national traffic widget must enforce that constraint, disclose unavailable roads/expired data, and never fill gaps with made-up congestion or ETAs. No traffic data connection is claimed in this release.

AirNow is a possible free U.S. AQI source. Its public city RSS feeds describe forecasts and action days; they must not be presented as current observations. The observation API requires an account/key. An hourly observation connection remains open; no AQI value was invented.

The existing widget-truth ratchet still contains 136 findings in 106 baseline entries, including non-data template sample fallbacks and documented review exceptions. A passing guard does not mean all 727 visual designs have received a complete visual/editability certification. This audit inventories every registration and fixes the data paths above; it does not conceal that separate legacy backlog.

## Validation

- Weather: 440 Chromium/WebKit layout × size × day-count checks; visual inspection of the reported wide/shallow size.
- Native editor: landscape/portrait weather and Newsroom control changes, toolbar typography, Save and reload verified in both browser engines.
- Backend: input validation, request coalescing, shared caches, throttling recovery, source retention/expiry, selected-domain/local-city filtering, entity decoding and date freshness tests.
- Exchange rates: source parser, stale/malformed table rejection, conversion and coalescing tests; rendered automatic/manual/unavailable cases.
- Calendars: source propagation, loading/error/empty states, sample isolation, manually entered content and all-day labels.
- Production build and CI are required before a release is reported as shipped. Real data captures in the review package identify the source and capture time; visual fixtures are identified separately.
- No player loader, Android APK, screen assignment, cache-clearing command, forced screen refresh, or G24/FUH activation policy is changed. Browser checks do not qualify the physical controllers.

## Primary sources

- [GDELT](https://www.gdeltproject.org/) and [rolling metadata feed](https://data.gdeltproject.org/gdeltv3/gal/feed.rss)
- [National Weather Service API](https://www.weather.gov/documentation/services-web-api)
- [ECB daily reference data](https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml), [reference-rate explanation](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html), and [reuse conditions](https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html)
- [AirNow API](https://docs.airnowapi.org/) and [forecast feed directory](https://feeds.airnowapi.org/)
- [TomTom monthly free allowances](https://docs.tomtom.com/pricing)
- [Caltrans public data](https://cwwp2.dot.ca.gov/)
