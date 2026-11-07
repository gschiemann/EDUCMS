import { act, render, screen } from "@testing-library/react";
import {
  AirQualityLiveWidget,
  AirportConditionsWidget,
  ParkingReportsLiveWidget,
  RoadIncidentsLiveWidget,
  TransitArrivalsLiveWidget,
} from "../PublicDataWidgets";
import { usePolledFeed } from "../use-live-feed";
let mockSize = { width: 960, height: 540 };
jest.mock("../v2/_shared/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, ...mockSize }),
}));
jest.mock("../use-live-feed", () => ({ usePolledFeed: jest.fn() }));
const poll = usePolledFeed as jest.Mock;
const now = Date.now();
const fresh = () => new Date(now).toISOString();
beforeEach(() => {
  jest.useFakeTimers({ now });
  mockSize = { width: 960, height: 540 };
  poll.mockReturnValue({ data: null, loading: false, error: false });
});
afterEach(() => jest.useRealTimers());
it("uses automatic source AQI and preserves its semantic category color while exposing toolbar fields", () => {
  poll.mockReturnValue({
    data: {
      area: "Concord",
      state: "CA",
      distanceKm: 10,
      matchedZip: true,
      observation: {
        aqi: 34,
        category: "Good",
        color: "#00e400",
        agency: "Bay Area Air District",
        observedAt: fresh(),
        pollutants: [{ name: "PM2.5", aqi: 34 }],
      },
    },
    loading: false,
  });
  const { container, rerender } = render(
    <AirQualityLiveWidget
      config={{
        location: "94583",
        style: { bgColor: "transparent" },
        _styles: { dataValue: { fontSize: 68, color: "#abcdef" } },
      }}
    />,
  );
  expect(container.querySelector('[data-field-jump="dataValue"]')).toHaveStyle({
    fontSize: "68px",
    color: "#abcdef",
  });
  expect(container.querySelector("[data-aqi-category]")).toHaveStyle({
    background: "#00e400",
  });
  expect(
    (container.querySelector("section") as HTMLElement).style.backgroundColor,
  ).toBe("transparent");
  expect(screen.getByText(/Preliminary/)).toBeInTheDocument();
  poll.mockReturnValue({
    data: {
      observation: { observedAt: new Date(now - 4 * 3600000).toISOString() },
    },
    loading: false,
  });
  rerender(<AirQualityLiveWidget config={{ location: "94583" }} />);
  expect(screen.queryByText("34")).toBeNull();
  expect(
    screen.getByText("Current air quality unavailable"),
  ).toBeInTheDocument();
});
it("has real cards/list/banner layouts and rotates through all FAA notices without canvas controls", () => {
  poll.mockReturnValue({
    data: {
      updatedAt: fresh(),
      items: Array.from({ length: 18 }, (_, i) => ({
        airport: "A" + String(i).padStart(2, "0"),
        type: "Ground delay program",
        reason: "Weather",
      })),
    },
    loading: false,
  });
  const { container, rerender } = render(
    <AirportConditionsWidget config={{ dataLayout: "cards" }} />,
  );
  expect(container.querySelector("[data-public-rows]")).toHaveAttribute(
    "data-row-layout",
    "cards",
  );
  expect(screen.getByText("A00 · Ground delay program")).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(10000));
  expect(screen.queryByText("A00 · Ground delay program")).toBeNull();
  rerender(<AirportConditionsWidget config={{ dataLayout: "list" }} />);
  expect(container.querySelector("[data-public-rows]")).toHaveAttribute(
    "data-row-layout",
    "list",
  );
  rerender(<AirportConditionsWidget config={{ dataLayout: "banner" }} />);
  expect(container.querySelector("[data-public-rows]")).toHaveAttribute(
    "data-row-layout",
    "banner",
  );
  expect(screen.queryByRole("button")).toBeNull();
});
it("shows unsupported parking geography plainly and never fills it with sample counts", () => {
  poll.mockReturnValue({
    data: {
      fetchedAt: fresh(),
      supported: false,
      reason: "Los Angeles street meters only",
      items: [],
    },
    loading: false,
  });
  render(<ParkingReportsLiveWidget config={{ location: "New York" }} />);
  expect(
    screen.getByText("Los Angeles street meters only"),
  ).toBeInTheDocument();
  expect(screen.queryByText("reported vacant")).toBeNull();
});
it("keeps parking unknown counts and source qualification attached to reported vacancies", () => {
  poll.mockReturnValue({
    data: {
      fetchedAt: fresh(),
      supported: true,
      items: [
        {
          name: "MAIN ST",
          vacant: 3,
          occupied: 8,
          unknown: 9,
          distanceKm: 0.2,
        },
      ],
    },
    loading: false,
  });
  render(<ParkingReportsLiveWidget config={{ location: "Los Angeles" }} />);
  expect(screen.getByText("reported vacant")).toBeInTheDocument();
  expect(screen.getByText(/9 unknown/)).toBeInTheDocument();
  expect(screen.getByText(/older than 30 min/)).toBeInTheDocument();
});
it("updates transit countdowns from one clock and does not show stale predictions", () => {
  const data = {
    station: "South Station",
    updatedAt: fresh(),
    items: [
      {
        id: "x",
        route: "Red",
        direction: "North",
        time: new Date(now + 5 * 60000).toISOString(),
        predictionKind: "prediction",
      },
    ],
  };
  poll.mockReturnValue({ data, loading: false });
  const { container, rerender } = render(
    <TransitArrivalsLiveWidget config={{ stationId: "place-sstat" }} />,
  );
  expect(
    container.querySelector('[data-field-jump="dataValue"]'),
  ).toHaveTextContent("5min");
  act(() => jest.advanceTimersByTime(60000));
  expect(
    container.querySelector('[data-field-jump="dataValue"]'),
  ).toHaveTextContent("4min");
  act(() => jest.advanceTimersByTime(90000));
  rerender(<TransitArrivalsLiveWidget config={{ stationId: "place-sstat" }} />);
  expect(
    screen.getByText("Current predictions unavailable"),
  ).toBeInTheDocument();
});
it("does not equate an empty incident feed to clear roads or generate an ETA", () => {
  poll.mockReturnValue({
    data: { fetchedAt: fresh(), supported: true, items: [] },
    loading: false,
  });
  render(<RoadIncidentsLiveWidget config={{ location: "94583" }} />);
  expect(screen.getByText(/does not confirm clear roads/)).toBeInTheDocument();
  expect(screen.queryByText(/ETA/)).toBeNull();
});
it("loads current data in the native builder despite its animation live=false, but never polls a picker thumbnail", () => {
  const { rerender } = render(
    <AirQualityLiveWidget live={false} config={{ location: "94583" }} />,
  );
  expect(poll.mock.calls[0][0]).toBe(true);
  poll.mockClear();
  rerender(
    <AirQualityLiveWidget
      live={false}
      config={{ location: "94583", _thumb: true }}
    />,
  );
  expect(poll.mock.calls[0][0]).toBe(false);
});
it("keeps an unconfigured wall widget quiet rather than showing an authoring prompt", () => {
  const { RenderSurfaceProvider } = require("../render-surface");
  const { container } = render(
    <RenderSurfaceProvider surface="player">
      <AirQualityLiveWidget config={{}} />
    </RenderSurfaceProvider>,
  );
  expect(container.textContent).toBe("");
});
