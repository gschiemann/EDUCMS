import { act, render, screen } from "@testing-library/react";
import {
  CurrentWeatherBoundary,
  hasCurrentWeather,
} from "../CurrentWeatherBoundary";
import { useLiveTemplateData } from "../lib/useLiveTemplateData";
import { fetchWeather } from "../weather-api";
jest.mock("../weather-api", () => ({
  ...jest.requireActual("../weather-api"),
  fetchWeather: jest.fn(),
}));
const fetchMock = fetchWeather as jest.Mock;
beforeEach(() => {
  jest.useFakeTimers();
  fetchMock.mockReset();
});
afterEach(() => jest.useRealTimers());
function Probe({
  location = "94583",
  override,
  metric = false,
  live = true,
}: {
  location?: string;
  override?: string;
  metric?: boolean;
  live?: boolean;
}) {
  const { weather } = useLiveTemplateData({
    live,
    clock: false,
    weatherLocation: location,
    weatherOverride: override,
    weatherUnits: metric ? "metric" : "imperial",
  });
  return (
    <div>
      {weather
        ? `${weather.temperature}|${weather.tempF}|${weather.high}|${weather.low}|${weather.condition}`
        : "No forecast"}
    </div>
  );
}
it("renders chosen units, real high/low values and drops the old place at once", async () => {
  fetchMock.mockResolvedValue({ temp: 10, high: 13, low: 6, weatherCode: 3 });
  const view = render(<Probe metric />);
  await act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
  });
  expect(screen.getByText("10|50|13|6|Overcast")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("94583", true);
  view.rerender(<Probe location="" metric />);
  expect(screen.getByText("No forecast")).toBeInTheDocument();
});
it("does not request weather for thumbnails, an unset location, or an entered override", async () => {
  const view = render(<Probe live={false} />);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(<Probe override="70°" />);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
  view.rerender(<Probe location="" />);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("bounds failed refresh retention to an hour", async () => {
  fetchMock
    .mockResolvedValueOnce({ temp: 50, high: null, low: null, weatherCode: -1 })
    .mockResolvedValue(null);
  render(<Probe />);
  await act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
  });
  expect(screen.getByText("50|50|null|null|")).toBeInTheDocument();
  for (let i = 0; i < 70; i++)
    await act(async () => {
      jest.advanceTimersByTime(60000);
      await Promise.resolve();
    });
  expect(screen.getByText("No forecast")).toBeInTheDocument();
});
it("credits actual forecast data with its license and never describes manual or missing data as live", async () => {
  fetchMock.mockResolvedValue({ temp: 50, geocoded: true });
  const view = render(
    <CurrentWeatherBoundary config={{ location: "94583" }}>
      <div>Content</div>
    </CurrentWeatherBoundary>,
  );
  await act(async () => {
    jest.advanceTimersByTime(600);
    await Promise.resolve();
  });
  expect(screen.getByRole("link", { name: "MET Norway" })).toHaveAttribute(
    "href",
    "https://www.met.no/en",
  );
  expect(screen.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute(
    "href",
    "https://creativecommons.org/licenses/by/4.0/",
  );
  expect(screen.getByText(/© OpenStreetMap/)).toBeInTheDocument();
  view.rerender(
    <CurrentWeatherBoundary config={{ staticTemp: 68 }}>
      <div>Content</div>
    </CurrentWeatherBoundary>,
  );
  expect(screen.getByText("Manually entered weather")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "MET Norway" })).toBeNull();
  view.rerender(
    <CurrentWeatherBoundary config={{}}>
      <div>Content</div>
    </CurrentWeatherBoundary>,
  );
  expect(screen.getByText("Set a weather location")).toBeInTheDocument();
});
it("keeps the NWS outlook on its own source while covering older current-weather templates", () => {
  expect(hasCurrentWeather("WEATHER", { variant: "weather-outlook" })).toBe(
    false,
  );
  expect(hasCurrentWeather("WEATHER", { forecastDays: 5 })).toBe(false);
  expect(hasCurrentWeather("WEATHER", { variant: "weather-glass" })).toBe(true);
  expect(hasCurrentWeather("MS_ARCADE_PORTRAIT", {})).toBe(true);
  expect(hasCurrentWeather("ANIMATED_WELCOME_HS", {})).toBe(true);
  expect(hasCurrentWeather("RSS_FEED", {})).toBe(false);
});

it('keeps the source credit readable on the chosen light or transparent surface',()=>{
 const view=render(<CurrentWeatherBoundary config={{style:{bgColor:'#ffffff',textColor:'#102b3c'},staticDesc:'Entered description'}}><div>Content</div></CurrentWeatherBoundary>);
 expect(view.container.querySelector('[data-current-weather-credit]')).toHaveStyle({background:'#ffffff',color:'#102b3c'});
 expect(screen.getByText('Manually entered weather')).toBeInTheDocument();
 view.rerender(<CurrentWeatherBoundary config={{style:{bgColor:'transparent',textColor:'#ffffff'}}}><div>Content</div></CurrentWeatherBoundary>);
 expect(view.container.querySelector('[data-current-weather-credit]')).toHaveStyle({background:'transparent',color:'#ffffff'});
});
