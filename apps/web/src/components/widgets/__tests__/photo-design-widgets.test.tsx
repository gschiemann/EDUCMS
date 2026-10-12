import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { PhotoCollageWidget, PhotoFrameWidget, normalizePhotoList } from "../PhotoDesignWidgets";
import { PhotoDesignFields } from "../../template-builder/PhotoDesignFields";

function EditorHarness({ initial }: { initial: Record<string, any> }) {
  const [config, setConfig] = useState(initial);
  return <>
    <PhotoDesignFields mode="collage" config={config} onChange={(patch) => setConfig((current) => ({ ...current, ...patch }))} />
    <PhotoCollageWidget config={config} />
  </>;
}

describe("photo design widgets", () => {
  it("keeps frame source, caption, shape and crop editable without timers", () => {
    render(<PhotoFrameWidget config={{ assetUrl: "/portrait.jpg", caption: "Senior portrait", focalX: 30, focalY: 40, zoom: 1.4, frameShape: "arch" }} />);
    const image = screen.getByAltText("Senior portrait");
    expect(image).toHaveAttribute("src", "/portrait.jpg");
    expect(image).toHaveStyle({ objectPosition: "30% 40%", transform: "scale(1.4)" });
    expect(screen.getByText("Senior portrait")).toBeInTheDocument();
    expect(document.querySelector("[data-photo-frame=arch]")).toBeInTheDocument();
    expect((document.querySelector("[data-photo-frame]") as HTMLElement).style.animation).toBe("");
  });

  it("changes captions and focal controls, then resets framing to center and 1x", () => {
    const onChange = jest.fn();
    render(<PhotoDesignFields mode="collage" config={{ photos: [{ url: "/a.jpg", caption: "Before", focalX: 50, focalY: 50, zoom: 1 }] }} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Photo 1 caption"), { target: { value: "After" } });
    expect(onChange).toHaveBeenLastCalledWith({ photos: [expect.objectContaining({ caption: "After" })] });
    fireEvent.change(screen.getByLabelText("Photo 1 horizontal framing"), { target: { value: "72" } });
    expect(onChange).toHaveBeenLastCalledWith({ photos: [expect.objectContaining({ focalX: 72 })] });
    fireEvent.change(screen.getByLabelText("Photo 1 zoom"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Reset framing" }));
    expect(onChange).toHaveBeenLastCalledWith({ photos: [expect.objectContaining({ focalX: 50, focalY: 50, zoom: 1 })] });
  });

  it("shows every collage photo at once and retains sources when changing layout", () => {
    const initial = { layout: "pair", photos: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg"].map((url) => ({ url, caption: url })) };
    render(<EditorHarness initial={initial} />);
    const collage = document.querySelector("[data-photo-collage]");
    expect(collage).toHaveAttribute("data-photo-count", "4");
    expect(collage?.querySelectorAll("[data-photo-index]")).toHaveLength(4);
    expect(screen.getAllByRole("img").filter((item) => item.getAttribute("alt")?.startsWith("/"))).toHaveLength(4);
    fireEvent.change(document.querySelector('select[aria-label="Collage layout"]')!, { target: { value: "featured" } });
    expect(document.querySelector("[data-photo-collage]")).toHaveAttribute("data-layout", "featured");
    expect(Array.from(document.querySelectorAll("[data-photo-index]")).map((node) => node.getAttribute("data-photo-index"))).toEqual(["0", "1", "2", "3"]);
    expect(screen.getAllByText("/a.jpg").length).toBeGreaterThan(0);
    expect(screen.getAllByText("/d.jpg").length).toBeGreaterThan(0);
  });

  it("promotes legacy URLs and leaves longer saved lists visible and editable", () => {
    expect(normalizePhotoList({ urls: ["/old-1.jpg", "/old-2.jpg"] }).map((photo) => photo.url)).toEqual(["/old-1.jpg", "/old-2.jpg"]);
    const config = { urls: ["/a.jpg", "/b.jpg", "/c.jpg", "/d.jpg", "/e.jpg"] };
    render(<>
      <PhotoDesignFields mode="collage" config={config} onChange={jest.fn()} />
      <PhotoCollageWidget config={config} />
    </>);
    expect(screen.getByText(/5 saved photos are kept and editable/)).toBeInTheDocument();
    expect(document.querySelector("[data-photo-collage]")).toHaveAttribute("data-photo-count", "5");
    expect(screen.getByLabelText("Photo 5 image")).toBeInTheDocument();
    expect(screen.getByLabelText("Remove photo 5")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-photo-index]")).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /Add photo/ })).not.toBeInTheDocument();
  });

  it("offers a vector empty placeholder and can add a photo up to the new-collage cap", () => {
    const onChange = jest.fn();
    render(<>
      <PhotoDesignFields mode="collage" config={{ photos: [] }} onChange={onChange} />
      <PhotoCollageWidget config={{ photos: [] }} />
    </>);
    expect(screen.getByRole("img", { name: "Add photos to build a collage" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add photo/ }));
    expect(onChange).toHaveBeenCalledWith({ photos: [expect.objectContaining({ url: "", focalX: 50, focalY: 50, zoom: 1 })] });
  });
});

describe("photo design editor controls", () => {
  it("injects the shared asset picker and font selector callbacks", () => {
    const change = jest.fn();
    const assetPicker = jest.fn(({ label, value, onChange }) => <button type="button" onClick={() => onChange("/library.jpg")}>{label}: {value || "Browse library"}</button>);
    const fontPicker = jest.fn(({ label, value, onChange }) => <button type="button" onClick={() => onChange("Inter")}>{label}: {value || "Choose font"}</button>);
    render(<PhotoDesignFields mode="collage" config={{ photos: [{ url: "" }] }} onChange={change} renderAssetPicker={assetPicker} renderFontPicker={fontPicker} />);
    fireEvent.click(screen.getByRole("button", { name: /Photo 1 image/ }));
    expect(change).toHaveBeenCalledWith({ photos: [expect.objectContaining({ url: "/library.jpg" })] });
    fireEvent.click(screen.getByRole("button", { name: /Caption font/ }));
    expect(change).toHaveBeenLastCalledWith({ captionFont: "Inter" });
  });
});
