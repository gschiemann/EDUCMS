/**
 * Paid live-data integrations (stocks, crypto, flights, scores, traffic):
 *   1. picker visibility follows `/integrations/live-data/status`, family by family;
 *   2. a dormant family renders the original (manual) board, unchanged;
 *   3. an enabled family renders the live board with its credit line, and
 *      carries the shared layout / text-style customisation.
 */
import { render, screen } from "@testing-library/react";

import "@/components/widgets/variants-register";
import { listVariants } from "@/components/widgets/variants";
import { applyLiveDataStatus } from "../use-live-data-discovery";
import { isWidgetDiscoverable, hasNoLiveDataSource } from "../widget-discovery";
import { useLiveData } from "@/lib/live-data/live-data-client";
import { StockTickerSwitch, DeparturesBoardSwitch, ScoresBoardSwitch } from "../v2/IntegrationSwitchWidgets";
import { TrafficLiveWidget } from "../IntegrationDataWidgets";

jest.mock("../v2/_shared/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, width: 960, height: 540 }),
}));
jest.mock("@/lib/live-data/live-data-client", () => {
  const actual = jest.requireActual("@/lib/live-data/live-data-client");
  return { ...actual, useLiveData: jest.fn() };
});
const live = useLiveData as jest.Mock;

const status = (on: string[]) =>
  Object.fromEntries(
    ["traffic", "flights", "scores", "stocks", "crypto"].map((f) => [f, { enabled: on.includes(f), source: f, missing: on.includes(f) ? [] : ["X"] }]),
  ) as never;

afterEach(() => applyLiveDataStatus(status([])));

describe("picker visibility", () => {
  it("dormant deploy: stocks, crypto, departures and scores stay out of the picker", () => {
    applyLiveDataStatus(status([]));
    const ids = new Set(listVariants().map((v) => v.id));
    for (const id of ["stock-ticker", "crypto-ticker", "departures-board", "sports-scoreboard"]) {
      expect(ids.has(id)).toBe(false);
      expect(hasNoLiveDataSource(id)).toBe(true);
    }
  });

  it("each family returns on its own key, and only that family", () => {
    applyLiveDataStatus(status(["stocks"]));
    expect(isWidgetDiscoverable("stock-ticker")).toBe(true);
    expect(isWidgetDiscoverable("crypto-ticker")).toBe(false);
    expect(new Set(listVariants().map((v) => v.id)).has("stock-ticker")).toBe(true);
    applyLiveDataStatus(status(["flights", "scores", "crypto"]));
    expect(isWidgetDiscoverable("stock-ticker")).toBe(false);
    expect(isWidgetDiscoverable("departures-board")).toBe(true);
    expect(isWidgetDiscoverable("sports-scoreboard")).toBe(true);
    expect(isWidgetDiscoverable("crypto-ticker")).toBe(true);
  });

  it("no integration feeds them: flight-status-hero and news-headlines stay hidden with every key", () => {
    applyLiveDataStatus(status(["traffic", "flights", "scores", "stocks", "crypto"]));
    expect(isWidgetDiscoverable("flight-status-hero")).toBe(false);
    expect(isWidgetDiscoverable("news-headlines")).toBe(false);
  });

  it("an unknown status (request failed) changes nothing", () => {
    applyLiveDataStatus(status(["stocks"]));
    applyLiveDataStatus(null);
    expect(isWidgetDiscoverable("stock-ticker")).toBe(true);
  });
});

describe("rendering", () => {
  it("dormant: the original board renders (no live credit)", () => {
    live.mockReturnValue({ data: { enabled: false }, loading: false });
    render(<StockTickerSwitch config={{ symbolList: "AAPL" }} />);
    expect(screen.queryByText(/Data provided by/)).toBeNull();
    expect(screen.getByText("Markets")).toBeInTheDocument();
  });

  it("enabled: live quotes with the provider credit, and the shared text styles apply", () => {
    live.mockReturnValue({
      data: {
        enabled: true,
        source: "Twelve Data",
        sourceUrl: "https://twelvedata.com/",
        fetchedAt: new Date().toISOString(),
        items: [{ symbol: "AAPL", name: "Apple Inc", price: 148.85, change: -0.24, pct: -0.16, currency: "USD", marketOpen: false }],
      },
      loading: false,
    });
    const { container } = render(
      <StockTickerSwitch config={{ symbolList: "AAPL", dataLayout: "list", _styles: { dataValue: { color: "#abcdef" } } }} />,
    );
    expect(screen.getByText("Twelve Data")).toBeInTheDocument();
    expect(screen.getByText(/148\.85/)).toBeInTheDocument();
    expect(container.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe("list");
    expect(container.querySelector('[data-field-jump="dataValue"]')).toHaveStyle({ color: "#abcdef" });
    expect(live).toHaveBeenLastCalledWith("/stocks?symbols=AAPL", 60000);
  });

  it("a board with typed rows stays manual and never asks the provider", () => {
    live.mockClear();
    render(<StockTickerSwitch config={{ symbols: [{ symbol: "XYZ", price: 1, change: 0, pct: 0 }] }} />);
    expect(live).not.toHaveBeenCalled();
  });

  it("flights: no airport chosen → no request, original board", () => {
    live.mockClear();
    live.mockReturnValue({ data: null, loading: false });
    render(<DeparturesBoardSwitch config={{}} />);
    expect(live).not.toHaveBeenCalled();
  });

  it("flights: live departures render airport-local time, gate and status", () => {
    live.mockReturnValue({
      data: {
        enabled: true,
        source: "AeroDataBox",
        fetchedAt: new Date().toISOString(),
        items: [{ flight: "QR 1045", airline: "Qatar", time: "12:20", revised: "", place: "Doha", placeCode: "DOH", gate: "A3", terminal: "A", status: "CANCELLED" }],
      },
      loading: false,
    });
    render(<DeparturesBoardSwitch config={{ airportCode: "AUH" }} />);
    expect(screen.getByText(/Doha/)).toBeInTheDocument();
    expect(screen.getByText("Gate A3")).toBeInTheDocument();
    expect(screen.getByText(/CANCELLED/)).toBeInTheDocument();
    expect(live).toHaveBeenLastCalledWith("/flights?airport=AUH&direction=departures", 120000);
  });

  it("scores: live period/clock, finals, team filter", () => {
    live.mockReturnValue({
      data: {
        enabled: true,
        source: "TheSportsDB",
        league: "English Premier League",
        fetchedAt: new Date().toISOString(),
        items: [
          { id: "1", state: "live", period: "2H", clock: "85", home: { name: "Wolves", score: 1 }, away: { name: "Brentford", score: 2 }, startsAt: "", venue: "" },
          { id: "2", state: "final", period: "", clock: "", home: { name: "Arsenal", score: 3 }, away: { name: "Chelsea", score: 0 }, startsAt: "", venue: "" },
        ],
      },
      loading: false,
    });
    const { rerender } = render(<ScoresBoardSwitch config={{ leagueId: "4328" }} />);
    expect(screen.getByText("2H · 85")).toBeInTheDocument();
    expect(screen.getByText("FINAL")).toBeInTheDocument();
    rerender(<ScoresBoardSwitch config={{ leagueId: "4328", teamFilter: "arsenal" }} />);
    expect(screen.queryByText("Wolves")).toBeNull();
    expect(screen.getByText("Arsenal")).toBeInTheDocument();
  });

  it("traffic: dormant falls back to the free CHP board; enabled shows TomTom incidents", () => {
    live.mockReturnValue({ data: { enabled: false }, loading: false });
    render(<TrafficLiveWidget config={{ location: "Denver, CO" }} fallback={<div>CHP board</div>} />);
    expect(screen.getByText("CHP board")).toBeInTheDocument();
    live.mockReturnValue({
      data: {
        enabled: true,
        source: "TomTom",
        fetchedAt: new Date().toISOString(),
        items: [{ id: "a", type: "Traffic jam", road: "I-25", area: "Exit 210 → Exit 213", delayMin: 12, severity: "major", distanceKm: 4 }],
      },
      loading: false,
    });
    render(<TrafficLiveWidget config={{ location: "Denver, CO", radiusKm: 10 }} fallback={<div>CHP</div>} />);
    expect(screen.getByText("I-25", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/\+12 min/)).toBeInTheDocument();
  });
});
