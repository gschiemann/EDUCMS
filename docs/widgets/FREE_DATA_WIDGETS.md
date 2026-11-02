# Free data widgets

A source connection and an attractive layout are separate promises. These widgets show current provider values, source credit and time. If a source fails or the chosen place is outside coverage, they say so. No invented sample becomes a live reading.

## Operator setup

Add a widget in the existing template builder, set its location or station, choose a layout, then Save. To format part of the widget, choose **Text to format** and use the existing floating text toolbar. Background, text color and font use the existing appearance controls. A transparent background leaves the template visible. There is no second competing font-size slider.

| Widget | What to enter | Actual free coverage | Refresh |
| --- | --- | --- | --- |
| Air Quality | U.S. city, ZIP or coordinates; e.g. `94583` | EPA AirNow reporting areas. The board identifies the area and distance; a ZIP is not a measurement at the building. Values are AQI, not pollutant concentrations. | Checks every 10 minutes; observations are hourly and preliminary. |
| Airport Conditions | Three- or four-character airport code; e.g. `SFO`, or blank for all notices | FAA airport-wide U.S. delay programs, stops and restrictions. An airport restriction can apply only to certain operations; the reason is retained. Not individual flight tracking. | 2 minutes. |
| Transit Departures | Select an MBTA station | MassDOT / MBTA Boston-area predictions. Schedule-based bus estimates are labelled. Not every U.S. agency. | 30 seconds. |
| Parking Availability | Los Angeles street location; e.g. `34.103325,-118.325308` | LADOT / LA ExpressPark street-meter sensor reports within 1.5 km. Streets with recent readings appear first. Not a private garage or a national parking feed. | 1 minute. |
| Road Conditions Board | California city, ZIP or coordinates; e.g. `94583` | Public mapped CHP travel incidents within 50 km. No camera images, vehicle tracking, commute ETA or invented congestion speed. | 1 minute. |
| Newsroom | Local ZIP/city and desired Local / National / International coverage | GDELT headline metadata with outlet selection, rotation and scrolling banner. Some places/outlets have no matching current stories. | 10 minutes, with earlier retries for limited coverage. |
| Forecast / current weather | Location and 2–5 forecast days when desired | NWS U.S. multi-day outlook; MET Norway current-hour forecast. The latter is a forecast, not a station observation. | Existing automatic weather refresh. |
| Daily Exchange Rates | Base currency | ECB business-day reference rates. Not tradable market quotes. | Existing daily source refresh. |

**Parking interpretation:** “reported vacant” counts recent vacant reports, not guaranteed spaces. Unreported meters, unknown states and reports older than 30 minutes are unknown. A street with only unknown readings displays a dash and “No recent readings.” Source outages never become “Full” or “All spaces available.” A driver must follow posted parking restrictions; this feed does not determine whether parking is legal at that moment.

**Layouts:** Automatic, Cards, List and Horizontal Banner. Entries that do not fit rotate to additional pages every 10 seconds. Capacity is measured from the rendered content; a long notice or larger toolbar font reduces the number of entries rather than forcing all text smaller. Newsroom retains its existing seconds-per-headline and banner scroll-speed controls. Its compact layouts use balanced internal margins independent of font size.

Existing saved manual counts, schedules and readings stay manual. Their row editors remain available through **Data → Enter my own values**. The separate flight and market widgets remain renderable for saved templates but are hidden from new standard discovery until an appropriate free automatic source qualifies. No paid service or account has been added.

## Broader traffic and garage coverage

The connected sources above require **no key, account or customer setup beyond the location/station**. They do not fulfill a nationwide live-traffic promise.

For nationwide road data, [TomTom's current free quotas](https://docs.tomtom.com/pricing) require a provider account and API key. A key is not currently connected to this build, and merely obtaining one does not activate a widget. A separate server adapter and request-budget controls are needed before claiming that coverage. A small free monthly incident quota can be exhausted by continuous signage polling; any future adapter must share cached data, enforce a hard free allowance and stop rather than incur paid overages. Do not enter a provider secret in a saved template or paste it into a chat. The owner would configure it securely on the existing API deployment after that integration is implemented and verified.

Garage availability comes from the garage operator's actual sensor/count feed. There is no universal free count source for private garages. This release connects public Los Angeles street meters and preserves entered garage counts; it does not pretend to connect a private garage without its feed. No nationwide or private-garage provider is billed or silently enabled.

## Sources and implementation

- [EPA AirNow FAQ and data guidance](https://docs.airnowapi.org/faq), public [hourly reporting-area data](https://files.airnowtech.org/airnow/today/reportingarea.dat) and [ZIP mapping](https://files.airnowtech.org/airnow/today/cityzipcodes.csv). EPA category colors and preliminary/source credit are preserved.
- [FAA NAS Status](https://nasstatus.faa.gov/) and [public XML](https://nasstatus.faa.gov/api/airport-status-information). No airline flight schedule is inferred.
- [MBTA's official GTFS-Realtime documentation](https://github.com/mbta/gtfs-documentation/blob/master/reference/gtfs-realtime.md), [shared enhanced trip updates](https://cdn.mbta.com/realtime/TripUpdates_enhanced.json), API-v3 stops/routes, and [MassDOT developer license](https://www.mass.gov/doc/developers-license-agreement-11132009/download). Provider credit is shown; no provider logo or endorsement is implied.
- [LADOT meter occupancy](https://data.lacity.org/d/e7h6-4a3e) and [meter inventory](https://data.lacity.org/d/s49e-q6j2). Both catalogs identify the datasets as public domain; occupancy timestamps are UTC and describe last known states.
- [CHP public traffic information](https://www.chp.ca.gov/traffic), [incident XML](https://media.chp.ca.gov/sa_xml/sa.xml), and [Caltrans commercial/public traveler-information portal](https://dot.ca.gov/programs/traffic-operations/traveler-information/cwwp). Only mapped travel summaries are exposed; dispatcher narratives are excluded.

All new upstream hosts are fixed in server code. Existing SSRF-safe transport checks DNS/redirects, bounds response size and time, and shares cached source snapshots across screens. Transit uses one bulk feed rather than one anonymous provider request per screen/station. Source timestamps are validated. CHP additionally requires a recent HTTP Last-Modified timestamp. Nothing modifies screen assignments, APKs, the player loader or its activation policy.

## Removed from the picker (2026-11-01 owner rule: no "enter it yourself" data widgets)

A data widget either reads a real source or is not offered for new screens.
Saved boards keep rendering; the builder shows "This widget has no live data source."
(`widget-discovery.ts`, `HIDDEN_UNLICENSED_DATA_WIDGETS`).

| Family | Verdict | Why |
|---|---|---|
| Stock ticker, Crypto ticker | Removed | Real-time quotes need a licensed feed; free endpoints forbid public display. |
| Departures board, Flight status | Removed | No free per-flight source with schedules/gates. FAA airport conditions is the live replacement. Candidate to build: OpenSky Network (free, rate-limited, position/altitude by callsign only, no schedules). |
| News Headlines (entered) | Removed | Newsroom (GDELT) and RSS widgets are the live replacements. |
| Scores Board (entered) | Removed | Bound-game scoreboards are the live replacement. |
| Air quality, Road conditions, Transit, Parking, Airport conditions, FX rates | Live | AirNow, CHP (California only), MBTA (Boston only), LADOT (Los Angeles only), FAA, ECB. Nationwide traffic/transit/parking still needs a source per region. |

## Free coverage added 2026-11-01 (integrations wave, PR #221)

**Road conditions** — CHP incidents (California) plus DOT work zones, lane closures and detours from the USDOT **WZDx** feeds (`apps/api/src/feeds/work-zones.service.ts`). Registry: <https://data.transportation.gov/d/69qe-yiui> (Public Domain U.S. Government). Each feed is listed only if it is keyless and its own `feed_info.license` is CC0 1.0 (<https://creativecommons.org/publicdomain/zero/1.0/>); the parser re-checks the licence on every fetch and refuses a feed that stops declaring it. Covered: Utah, Minnesota, Maryland, Missouri, Wisconsin, Hawaii, Washington, New Jersey, Kentucky, Kansas, Delaware, Louisiana, Indiana, Mississippi, North Dakota, Austin (TX) and Maricopa County (AZ). Not listed: feeds that need a key (CO, TX, VA, OH, OR, NC, IL, PA Turnpike, MI, MA, Bay Area 511), embed a token in the URL (OK, FL), or declare no licence (IA, ID, New England). Each feed refreshes every 10 minutes server-side, shared by every screen.

**Transit** — a generic GTFS-realtime departures engine (`apps/api/src/feeds/gtfs/`: zip, CSV and protobuf readers with no new dependency). An agency is one reviewed entry in `GTFS_AGENCIES`, only if keyless and its licence allows redistribution:

| Agency | Licence |
|---|---|
| MBTA (existing v3 integration) | MassDOT Developers License Agreement, via <https://www.mbta.com/developers> |
| BART | <https://www.bart.gov/schedules/developers/developer-license-agreement> — "use, reproduce, and redistribute"; no BART marks |
| RTD Denver | <https://www.rtd-denver.com/open-records/open-spatial-information/gtfs-realtime-license-agreement> — "use, reproduce, and redistribute"; no RTD marks; unofficial |

Keyless but awaiting a licence read before listing: MTA NYC subway (commercial apps "may be charged a license fee"), King County Metro, Calgary, Edmonton, Halifax. SEPTA needs written permission.

**Flights** — no further free source: FAA NAS status (already live as Airport conditions) is the public-domain airport data; FAA ASWS no longer answers; BTS on-time data is monthly history; OpenSky is non-commercial. The departures board stays hidden unless the paid AeroDataBox key is set.

**Scores** — no official free feed allows commercial display (MLB's statsapi copyright notice: "non-commercial, non-bulk use"; NHL.com terms: "non-commercial, informational, personal use"). The scores board stays hidden unless the paid TheSportsDB key is set.
