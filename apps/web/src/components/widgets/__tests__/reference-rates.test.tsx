import { render, screen } from "@testing-library/react";
import { FxRatesWidget } from "../v2/LiveDataWidgets";
import { RenderSurfaceProvider } from "../render-surface";
import { useReferenceRates } from "../use-reference-rates";
jest.mock("../use-reference-rates", () => ({
  useReferenceRates: jest.fn(),
  DISPLAY_CURRENCIES: ["EUR", "USD", "GBP"],
}));
const feed = useReferenceRates as jest.Mock;
beforeEach(() =>
  feed.mockReturnValue({
    data: {
      base: "USD",
      date: "2026-10-28",
      rates: [
        { code: "EUR", rate: 0.9 },
        { code: "GBP", rate: 0.8 },
      ],
    },
    loading: false,
    error: false,
  }),
);
it("shows dated real reference values and a free source credit on a screen", () => {
  const { container } = render(
    <RenderSurfaceProvider surface="player">
      <FxRatesWidget config={{ base: "USD" }} />
    </RenderSurfaceProvider>,
  );
  expect(screen.getByText("0.9000")).toBeInTheDocument();
  expect(screen.getByText(/Free source: ECB/)).toHaveTextContent("2026-10-28");
  expect(container.querySelector("[data-manual-data]")).toBeNull();
  expect(container.querySelector("[data-live-data-sample]")).toBeNull();
  expect(feed).toHaveBeenCalledWith(true, "USD");
});
it("preserves existing entered rates and marks them as manually updated", () => {
  render(
    <RenderSurfaceProvider surface="player">
      <FxRatesWidget
        config={{
          pairs: [
            {
              code: "CAD",
              rate: 1.37,
              name: "Canadian dollar",
              flag: "",
              delta: 0,
            },
          ],
        }}
      />
    </RenderSurfaceProvider>,
  );
  expect(screen.getByText("1.3700")).toBeInTheDocument();
  expect(screen.getByText("Manually updated")).toBeInTheDocument();
  expect(feed).toHaveBeenCalledWith(false, "USD");
});
it("never fills an unavailable automatic feed with sample values", () => {
  feed.mockReturnValue({ data: null, loading: false, error: true });
  render(
    <RenderSurfaceProvider surface="player">
      <FxRatesWidget config={{ dataMode: "automatic" }} />
    </RenderSurfaceProvider>,
  );
  expect(screen.getByText(/Temporarily unavailable/)).toBeInTheDocument();
  expect(screen.queryByText("0.9241")).toBeNull();
});
