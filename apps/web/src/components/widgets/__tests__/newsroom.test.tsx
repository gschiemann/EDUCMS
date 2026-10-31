import { render, screen } from "@testing-library/react";
import { NewsroomWidget } from "../NewsroomWidget";
import {
  balanceNews,
  backgroundWithOpacity,
  type NewsResult,
} from "../newsroom-model";
jest.mock("../newsroom.css", () => ({}));
jest.mock("../v2/_shared/useElementSize", () => ({
  useElementSize: () => ({ ref: { current: null }, width: 3840, height: 2160 }),
}));
jest.mock("../use-live-feed", () => ({
  usePolledFeed: () => ({ data: null, loading: false, error: true }),
}));
const row = (
  scope: "local" | "national" | "world",
  title: string,
): NewsResult => ({
  scope,
  location: "San Ramon, CA",
  provider: "GDELT",
  fetchedAt: new Date().toISOString(),
  items: [
    {
      scope,
      title,
      link: `https://example.com/${scope}`,
      publisher: "example.com",
      indexedAt: new Date().toISOString(),
    },
  ],
});
describe("Newsroom", () => {
  it("shows real captured headlines as a captured preview, with safe text and index dates", () => {
    render(
      <NewsroomWidget
        previewData={[row("local", "<img src=x onerror=alert(1)>")]}
      />,
    );
    expect(screen.getByText("Captured preview · not live")).toBeInTheDocument();
    expect(
      screen.getByText("<img src=x onerror=alert(1)>"),
    ).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/Indexed/)).toBeInTheDocument();
  });
  it("uses toolbar typography and changes only background opacity", () => {
    const { container } = render(
      <NewsroomWidget
        config={{
          _styles: { headline: { fontSize: 84, color: "#abcdef" } },
          bgColor: "#112233",
          backgroundOpacity: 30,
        }}
        previewData={[row("local", "Local news")]}
      />,
    );
    expect(container.querySelector(".nr-headline")).toHaveStyle({
      fontSize: "84px",
      color: "#abcdef",
    });
    expect(container.querySelector(".nr-surface")).toHaveStyle({
      background: "#112233",
      opacity: 0.3,
    });
  });
  it("never substitutes samples or reports an unavailable feed as live", () => {
    render(<NewsroomWidget />);
    expect(
      screen.getByText("News temporarily unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("Updates delayed")).toBeInTheDocument();
  });
  it("balances scopes and removes syndicated duplicates", () => {
    expect(
      balanceNews([
        row("local", "Shared story"),
        row("national", "Shared story"),
        row("world", "World story"),
      ]).map((a) => a.scope),
    ).toEqual(["local", "world"]);
    expect(backgroundWithOpacity("#ffffff", 0)).toBe("rgba(255,255,255,0)");
  });
});

it('styles edition, source, dates, status and credits through the existing toolbar schema', () => {
 const keys=['edition','source','indexed','status','section','footer'];
 const styles=Object.fromEntries(keys.map(k=>[k,{fontSize:32,color:'#335577'}]));
 const {container}=render(<NewsroomWidget config={{_styles:styles}} previewData={[row('local','Story one'),row('world','Story two')]} />);
 for(const key of keys) expect(container.querySelector(`[data-field-jump="${key}"]`)).toHaveStyle({fontSize:'32px',color:'#335577'});
});
