import { render, screen } from "@testing-library/react";
import {
  withCalendarFeed,
  calendarDisplayEvents,
} from "../CalendarFeedBoundary";
import { useLiveIcsFeed } from "../use-live-feed";
import { RenderSurfaceProvider } from "../render-surface";
import type { CalendarFeedEvent } from "../feed-types";
jest.mock("../use-live-feed", () => ({ useLiveIcsFeed: jest.fn() }));
const feed = useLiveIcsFeed as jest.Mock;
const fixture: CalendarFeedEvent = {
  title: "Tenant briefing",
  start: "2026-10-29T16:00:00Z",
  end: null,
  location: "Suite 201",
  allDay: false,
};
const Design = ({ config }: { config: any }) => (
  <div>
    {(config.events?.length
      ? config.events
      : [{ title: "Invented spring concert" }]
    ).map((e: any, i: number) => (
      <p key={i}>
        {e.title} {e.date} {e.time}
      </p>
    ))}
  </div>
);
const Calendar = withCalendarFeed(Design);
beforeEach(() =>
  feed.mockReturnValue({ events: [fixture], loading: false, error: false }),
);
it("supplies actual ICS rows to the selected design and clears its URL to avoid a second fetch", () => {
  render(
    <RenderSurfaceProvider surface="player">
      <Calendar config={{ feedUrl: "https://school.example/calendar.ics" }} />
    </RenderSurfaceProvider>,
  );
  expect(screen.getByText(/Tenant briefing/)).toBeInTheDocument();
  expect(screen.queryByText(/Invented spring concert/)).toBeNull();
  expect(screen.getByText("Connected calendar")).toBeInTheDocument();
  expect(feed).toHaveBeenCalledWith("https://school.example/calendar.ics");
});
it.each([
  [null, true, false, "Loading calendar…"],
  [null, false, true, "Calendar temporarily unavailable"],
  [[], false, false, "No upcoming events"],
])(
  "never lets a design replace a missing feed with fake events",
  (events, loading, error, label) => {
    feed.mockReturnValue({ events, loading, error });
    render(
      <RenderSurfaceProvider surface="player">
        <Calendar config={{ feedUrl: "https://school.example/calendar.ics" }} />
      </RenderSurfaceProvider>,
    );
    expect(screen.getByText(label as string)).toBeInTheDocument();
    expect(screen.queryByText(/Invented/)).toBeNull();
  },
);
it("labels entered events and permits stamped builder-only samples", () => {
  const player = render(
    <RenderSurfaceProvider surface="player">
      <Calendar
        config={{ events: [{ title: "Entered meeting", date: "Today" }] }}
      />
    </RenderSurfaceProvider>,
  );
  expect(screen.getByText(/Entered meeting/)).toBeInTheDocument();
  expect(screen.getByText("Manually updated")).toBeInTheDocument();
  player.unmount();
  const builder = render(<Calendar config={{}} />);
  expect(screen.getByText(/Invented spring concert/)).toBeInTheDocument();
  expect(
    builder.container.querySelector("[data-live-data-sample]"),
  ).not.toBeNull();
});
it("does not show invented events on an empty real screen", () => {
  render(
    <RenderSurfaceProvider surface="player">
      <Calendar config={{}} />
    </RenderSurfaceProvider>,
  );
  expect(
    screen.getByText("Add events or connect an ICS calendar"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Invented/)).toBeNull();
});
it("retains all-day dates and times explicitly", () => {
  expect(calendarDisplayEvents([{ ...fixture, allDay: true }])[0].time).toBe(
    "All day",
  );
});

it('attaches the calendar transport to every registered calendar design',()=>{
 require('../variants-register');
 const {listVariants}=require('../variants');
 const calendars=listVariants({widgetType:'CALENDAR'});
 expect(calendars.length).toBeGreaterThanOrEqual(31);
 for(const variant of calendars) if(!variant.previewOnly) expect(variant.render.displayName).toMatch(/^CalendarFeed\(/);
});
