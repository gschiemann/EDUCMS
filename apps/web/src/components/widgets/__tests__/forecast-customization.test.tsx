import { act, render, screen } from "@testing-library/react";
import {
  ForecastWeatherWidget,
  forecastDayCount,
} from "../ForecastWeatherWidget";
import { forecastIsTransparent, forecastLayout } from "../forecast-appearance";
import { RenderSurfaceProvider } from "../render-surface";
import { usePolledFeed } from "../use-live-feed";
jest.mock("../forecast-weather.css", () => ({}));
let mockSize = {width: 1920, height: 1080};
jest.mock("../v2/_shared/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, ...mockSize }),
}));
jest.mock("../use-live-feed", () => ({ usePolledFeed: jest.fn() }));
const poll = usePolledFeed as jest.Mock;
const data = {
  location: "San Ramon, CA",
  days: Array.from({ length: 5 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 9, 28 + i)).toISOString().slice(0, 10),
    high: 75 + i,
    low: 50 + i,
    condition: "Sunny",
    rain: 0,
  })),
  fetchedAt: new Date().toISOString(),
  source: "National Weather Service",
  geocoded: false,
};
beforeEach(() => {mockSize={width:1920,height:1080};poll.mockReturnValue({ data, loading: false, error: false });});
function draw(config: Record<string, unknown> = {}) {
  return render(
    <RenderSurfaceProvider surface="player">
      <ForecastWeatherWidget config={{ location: "94583", ...config }} />
    </RenderSurfaceProvider>,
  );
}
describe("Forecast appearance", () => {
  it("makes both backgrounds fully transparent while keeping all text opaque", () => {
    const { container } = draw({ forecastTransparent: true });
    expect(container.querySelector(".fw-surface")).toHaveStyle({ opacity: 0 });
    expect(container.querySelector(".fw-card-surface")).toHaveStyle({
      opacity: 0,
    });
    expect(
      (container.querySelector("[data-weather-outlook]") as HTMLElement).style
        .opacity,
    ).toBe("");
    expect(container.querySelectorAll("[data-forecast-day]")).toHaveLength(5);
  });
  it("defaults the clean overlay to transparency, with an explicit opaque override", () => {
    expect(forecastIsTransparent({ forecastLayout: "clean" })).toBe(true);
    expect(
      forecastIsTransparent({
        forecastLayout: "clean",
        forecastTransparent: false,
      }),
    ).toBe(false);
    expect(forecastLayout("auto", 5)).toBe("strip");
    expect(forecastLayout("auto", 0.6)).toBe("cards");
  });
  it("honors background opacity independently from text and every color role", () => {
    const { container } = draw({
      bgColor: "#123456",
      forecastBackgroundOpacity: 35,
      forecastCardColor: "#abcdef",
      forecastCardOpacity: 75,
      textColor: "#111111",
      forecastHighColor: "#222222",
      forecastLowColor: "#333333",
      forecastIconColor: "#444444",
      forecastDetailColor: "#555555",
      accentColor: "#666666",
    });
    expect(container.querySelector(".fw-surface")).toHaveStyle({
      background: "#123456",
      opacity: 0.35,
    });
    expect(container.querySelector(".fw-card-surface")).toHaveStyle({
      background: "#abcdef",
      opacity: 0.75,
    });
    for (const [selector, color] of [
      [".fw-high", "#222222"],
      [".fw-low", "#333333"],
      [".fw-icon", "#444444"],
    ])
      expect(container.querySelector(selector)).toHaveStyle({ color });
    expect(
      container.querySelector("[data-weather-outlook]")!.getAttribute("style"),
    ).toContain("--fw-details: #555555");
  });
  it("uses existing toolbar styling on both player and builder, including font aliases", () => {
    const { container } = draw({
      forecastFontFamily: "Georgia",
      _styles: {
        forecastHigh: {
          fontSize: 88,
          fontFamily: "Arial",
          bold: true,
          italic: true,
          color: "#fedcba",
          lineHeight: 1.1,
        },
      },
    });
    expect(container.querySelector("[data-weather-outlook]")).toHaveStyle({
      fontFamily: "Georgia",
    });
    const style = (container.querySelector(".fw-high") as HTMLElement).style;
    expect(style.fontSize).toBe("88px");
    expect(style.fontFamily).toBe("Arial");
    expect(style.fontWeight).toBe("800");
    expect(style.fontStyle).toBe("italic");
    expect(style.color).toBe("rgb(254, 220, 186)");
    expect(style.lineHeight).toBe("1.1");
    expect(container.querySelector(".fw-high")).toHaveAttribute(
      "data-field-jump",
      "forecastHigh",
    );
  });
  it("keeps NWS units and selected day counts wired to the existing endpoint", () => {
    const { container } = draw({ forecastDays: 3, units: "metric" });
    expect(container.querySelectorAll("[data-forecast-day]")).toHaveLength(3);
    expect(screen.getByText("°C")).toBeInTheDocument();
    const args = poll.mock.calls[poll.mock.calls.length - 1];
    expect(args[1]()).toContain("location=94583&units=metric");
    expect(forecastDayCount(99)).toBe(5);
    expect(forecastDayCount(1)).toBe(2);
  });
  it("never invents a forecast when the live feed is unavailable on a screen", () => {
    poll.mockReturnValue({ data: null, loading: false, error: true });
    const { container } = draw();
    expect(
      screen.getByText("Forecast temporarily unavailable"),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-forecast-day]")).toHaveLength(0);
  });
});

it('rotates every requested day in a narrow zone without shrinking all five into it',()=>{
 jest.useFakeTimers();
 try {
  mockSize={width:300,height:80};
  const {container}=draw({forecastDays:5});
  expect(container.querySelector('[data-weather-outlook]')).toHaveAttribute('data-page-count','5');
  const seen=new Set<string>();
  for(let i=0;i<5;i++) {
   expect(container.querySelectorAll('[data-forecast-day]')).toHaveLength(1);
   seen.add(container.querySelector('.fw-high')!.textContent!);
   act(()=>{jest.advanceTimersByTime(8000);});
  }
  expect(seen.size).toBe(5);
  expect(container.querySelector('[data-weather-outlook]')).toHaveAttribute('data-page','1');
 } finally {jest.useRealTimers();}
});
