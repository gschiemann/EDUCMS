import fs from "fs";
import path from "path";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ContentFields } from "../PropertiesPanel";

jest.mock("@/lib/api-client", () => ({
  ...jest.requireActual("@/lib/api-client"),
  apiFetch: jest.fn(() => new Promise(() => undefined)),
}));

const html = fs.readFileSync(
  path.resolve(
    __dirname,
    "../../../../public/templates/custom/brookfield/07-tour-takeaway.html",
  ),
  "utf8",
);
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mount(initial: Record<string, unknown> = {}, boardHtml = html) {
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, text: () => Promise.resolve(boardHtml) });
  const changed = jest.fn();
  function Editor() {
    const [cfg, setCfg] = useState<Record<string, unknown>>({
      url: "/templates/custom/brookfield/07-tour-takeaway.html",
      ...initial,
    });
    return (
      <ContentFields
        zone={{ id: "board", widgetType: "EXTERNAL_HTML", defaultConfig: cfg }}
        updateZone={(
          _id: string,
          patch: { defaultConfig: Record<string, unknown> },
        ) => {
          changed(patch.defaultConfig);
          setCfg(patch.defaultConfig);
        }}
      />
    );
  }
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Editor />
    </QueryClientProvider>,
  );
  return changed;
}

const gallery = () =>
  document.querySelector('[data-edit-img="tour.image"]') as HTMLElement;
const last = (changed: jest.Mock) => changed.mock.calls.at(-1)![0];

it("uses the existing sortable photo picker and shared playback labels, with simple logos and QR destinations", async () => {
  mount();
  await screen.findByText("+ Add photos from library");
  expect(
    within(gallery()).getAllByRole("button", { name: "Drag to reorder" }),
  ).toHaveLength(3);
  expect(screen.getByText("Show each photo for (seconds)")).toBeVisible();
  expect(screen.getByText("Transition between photos")).toBeVisible();
  expect(screen.queryByText("Playback", { exact: true })).toBeNull();
  expect(screen.queryByText(/Then show/)).toBeNull();
  expect(screen.queryByText("Slide 1", { exact: true })).toBeNull();
  const logo = document.querySelector(
    '[data-edit-img="brand.logo"]',
  ) as HTMLElement;
  expect(
    within(logo).queryByRole("button", { name: "Drag to reorder" }),
  ).toBeNull();
  expect(within(logo).getByText("Browse library")).toBeVisible();
  expect(screen.getByText("QR destination URL")).toBeVisible();
  expect(screen.queryByText("Or pick a QR image")).toBeNull();
});

it("removing the final photo persists an empty list rather than restoring the template defaults", async () => {
  const changed = mount();
  await screen.findByText("+ Add photos from library");
  for (let i = 0; i < 3; i++)
    fireEvent.click(
      within(gallery()).getAllByRole("button", { name: "Remove" })[0],
    );
  expect(last(changed).imageOverrides["tour.image"]).toEqual([]);
  expect(last(changed).textOverrides["media.tour.image.slides"]).toBe("[]");
  await waitFor(() =>
    expect(
      within(gallery()).queryByRole("button", { name: "Drag to reorder" }),
    ).toBeNull(),
  );
  expect(within(gallery()).getByText(/No photos yet/)).toBeVisible();
});

it("reads a saved native slide list and keeps unrelated overrides when changing fit and timing", async () => {
  const changed = mount({
    textOverrides: {
      "media.tour.image.slides": '["/custom.jpg"]',
      "tour.title": "Our homes",
    },
  });
  await screen.findByText("custom.jpg");
  fireEvent.change(within(gallery()).getAllByRole("combobox")[0], {
    target: { value: "contain" },
  });
  const timing = screen.getByDisplayValue("7");
  fireEvent.change(timing, { target: { value: "3" } });
  expect(last(changed).textOverrides).toMatchObject({
    "media.tour.image.slides": '["/custom.jpg"]',
    "media.tour.image.fit": "contain",
    "carousel.intervalSeconds": "3",
    "tour.title": "Our homes",
  });
});

it("changing the QR destination edits the field the board actually generates its code from", async () => {
  const changed = mount();
  const destination = await screen.findByDisplayValue(
    "https://www.brookfieldresidential.com/new-homes/california/north-bay/napa/napa-riversound",
  );
  fireEvent.change(destination, {
    target: { value: "https://example.com/model-tour" },
  });
  expect(last(changed).textOverrides["tour.url"]).toBe(
    "https://example.com/model-tour",
  );
  expect(last(changed).imageOverrides).toBeUndefined();
});

it('an uploaded photo list rotates even when the authored slot originally held one image', async () => {
  const single = html.replace(/(data-field="media.tour.image.mode"[^>]*>)carousel/, '$1single');
  mount({ imageOverrides: { 'tour.image': ['/a.jpg', '/b.jpg'] } }, single);
  await screen.findByText('+ Add photos from library');
  expect(within(gallery()).getByRole('switch')).toHaveAttribute('aria-checked', 'true');
});
