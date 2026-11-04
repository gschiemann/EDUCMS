/** Free road (CHP + WZDx) and open GTFS-realtime boards. */
import { render, screen } from "@testing-library/react";
import { RoadIncidentsLiveWidget, TransitArrivalsLiveWidget } from "../PublicDataWidgets";
import { usePolledFeed } from "../use-live-feed";

jest.mock("../v2/_shared/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, width: 960, height: 540 }),
}));
jest.mock("../use-live-feed", () => ({ usePolledFeed: jest.fn() }));
const poll = usePolledFeed as jest.Mock;
const now = Date.now();
const fresh = () => new Date(now).toISOString();
beforeEach(() => {
  jest.useFakeTimers({ now });
  poll.mockReset();
});
afterEach(() => jest.useRealTimers());

it("open GTFS agency: departures from the agency's feed, credited, minutes to departure", () => {
  poll.mockReturnValue({
    data: {
      agency: "BART",
      source: "BART open data",
      sourceUrl: "https://www.bart.gov/schedules/developers/developer-license-agreement",
      note: "Unofficial display · provided as is",
      station: "Lake Merritt",
      stationId: "LAKE",
      updatedAt: fresh(),
      fetchedAt: fresh(),
      items: [
        { id: "t1", route: "Yellow-S", direction: "to SFO / Millbrae", platform: "2", time: new Date(now + 4 * 60000).toISOString(), status: "", predictionKind: "prediction" },
      ],
    },
    loading: false,
  });
  render(<TransitArrivalsLiveWidget config={{ transitAgency: "bart", gtfsStationId: "LAKE" }} />);
  expect(screen.getByText("Lake Merritt")).toBeInTheDocument();
  expect(screen.getByText("BART open data")).toBeInTheDocument();
  expect(screen.getByText(/Yellow-S · to SFO/)).toBeInTheDocument();
  expect(screen.getByText(/Unofficial display/)).toBeInTheDocument();
  const url = poll.mock.calls[poll.mock.calls.length - 1][1]();
  expect(url).toMatch(/\/feeds\/gtfs-departures\?agency=bart&station=LAKE$/);
});

it("MBTA stays on its own feed when no other agency is chosen", () => {
  poll.mockReturnValue({ data: null, loading: true });
  render(<TransitArrivalsLiveWidget config={{ stationId: "place-sstat" }} />);
  const url = poll.mock.calls[poll.mock.calls.length - 1][1]();
  expect(url).toMatch(/\/feeds\/transit-arrivals\?station=place-sstat$/);
});

it("stale GTFS predictions are not shown", () => {
  poll.mockReturnValue({
    data: { agency: "BART", source: "BART open data", sourceUrl: "", note: "", station: "Lake Merritt", stationId: "LAKE", updatedAt: new Date(now - 10 * 60000).toISOString(), fetchedAt: fresh(), items: [] },
    loading: false,
  });
  render(<TransitArrivalsLiveWidget config={{ transitAgency: "bart", gtfsStationId: "LAKE" }} />);
  expect(screen.getByText("Current predictions unavailable")).toBeInTheDocument();
});

it("road conditions credit every publisher behind the rows (CHP + DOT work zones)", () => {
  poll.mockReturnValue({
    data: {
      location: "Baltimore, MD",
      supported: true,
      fetchedAt: fresh(),
      sources: [{ name: "Maryland DOT SHA", url: "https://data.transportation.gov/d/69qe-yiui", fetchedAt: fresh() }],
      items: [{ id: "w1", type: "Road work · Lanes closed", road: "I-695", area: "", distanceKm: 6, source: "DOT" }],
    },
    loading: false,
  });
  render(<RoadIncidentsLiveWidget config={{ location: "Baltimore, MD", radiusKm: 10 }} />);
  expect(screen.getByText("Maryland DOT SHA")).toBeInTheDocument();
  expect(screen.getByText(/Road work · Lanes closed · I-695/)).toBeInTheDocument();
  expect(screen.getByText("6 km away")).toBeInTheDocument();
  const url = poll.mock.calls[poll.mock.calls.length - 1][1]();
  expect(url).toMatch(/road-conditions\?location=Baltimore%2C%20MD&radiusKm=10$/);
});

it("road conditions outside free coverage say so instead of implying clear roads", () => {
  poll.mockReturnValue({
    data: { location: "Atlanta, GA", supported: false, reason: "No free road-report feed covers this location yet.", fetchedAt: fresh(), sources: [], items: [] },
    loading: false,
  });
  render(<RoadIncidentsLiveWidget config={{ location: "Atlanta, GA" }} />);
  expect(screen.getByText(/No free road-report feed covers/)).toBeInTheDocument();
});
