---
title: Building a custom template
category: Templates
updated: 2026-04-16
excerpt: Use the drag-and-drop template builder to design your own layout from scratch or customize a system preset.
---

# Building a custom template

Templates define the *layout* of a screen — where the clock goes, where the announcements ticker runs, which corner shows the lunch menu. You can either pick one of the 17 system presets or build your own.

## Start from a system preset (recommended)

Every system template is read-only, but one click makes an editable copy:

1. Open **Templates** in the sidebar.
2. Hover the preset you like and click **Use as starting point**.
3. Give your copy a name (e.g. "Lincoln ES — Main Hallway").

You now have a fully editable copy in your tenant's template library.

## Anatomy of a template

Every template has:

- **Canvas size** — defaults to 1920x1080 for landscape displays. Change it for portrait or video-wall installations.
- **Background** — a solid color, a gradient, or an uploaded image.
- **Zones** — rectangular regions that each render one widget.

Zones are positioned in **percentages** (0–100), not pixels, so layouts scale gracefully to any screen resolution.

## Adding a zone

1. In the builder, click **Add zone** in the toolbar.
2. Drag the zone to where you want it. Use the corner handles to resize.
3. From the right-hand panel, pick the **widget type** for that zone.

### Available widget types

- `CLOCK`, `WEATHER`, `COUNTDOWN`, `TEXT`, `RICH_TEXT`
- `ANNOUNCEMENT`, `TICKER`, `BELL_SCHEDULE`, `LUNCH_MENU`, `CALENDAR`
- `STAFF_SPOTLIGHT`, `IMAGE`, `IMAGE_CAROUSEL`, `VIDEO`, `LOGO`
- `WEBPAGE`, `RSS_FEED`, `SOCIAL_FEED`, `PLAYLIST`

Each widget has its own configuration panel — for example, the Clock widget lets you choose 12/24-hour format, font size, and theme variant.

## Layering (zIndex)

Zones can overlap. Use **Bring to front** / **Send to back** in the right-click menu, or set `zIndex` numerically (higher numbers render on top).

## Save, auto-save, and save-as-copy

- The builder **auto-saves every 10 seconds** while you're editing. You can't lose work to a refresh.
- Click **Save** to create a named version you can revert to.
- Click **Save as copy** to fork — useful when you want to try a variant without losing the original.

## Publishing

Saving doesn't automatically deploy the template to screens. To push it live, create a schedule that uses it (see [Scheduling](/help/getting-started)). This lets you preview a work-in-progress template safely without affecting what's currently showing.

## Accessibility + design tips

- Keep text at least 48pt for 1080p displays viewed from 10+ feet away.
- Use high-contrast color combinations — our brand indigo on white, or white text on dark gradients.
- Animated tickers should not exceed 40 characters per second of scroll speed.
