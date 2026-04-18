---
title: Playlists, schedules, and priority
category: Screens
updated: 2026-04-16
excerpt: Build rotating playlists, schedule them for specific days and times, and control what wins when multiple schedules overlap.
---

# Playlists, schedules, and priority

A **template** defines layout. A **playlist** is a rotating sequence of assets (or templates). A **schedule** says when and where a playlist plays.

## Playlists

Create one from **Playlists → New playlist**:

- Give it a name (e.g. "Morning announcements loop")
- Add items — each item references an asset (image, video, announcement) or a sub-template
- Set **dwell duration** per item (how long each one shows, in milliseconds)
- Pick a **transition** (fade, cut, slide, wipe)

Playlists can be nested: a playlist item can itself be a playlist. This is useful for "day of the week"-style variations.

## Schedules

A schedule binds a playlist to a target (screen or screen group) for a specific time window:

- **Date range** — start and end date (end date optional)
- **Days of week** — any subset of M T W Th F Sa Su
- **Time range** — e.g. 7:30 AM to 3:30 PM
- **Priority** — higher number wins when two schedules overlap

## Priority and conflicts

When multiple schedules apply to the same screen at the same time, the one with the **highest priority** wins. For ties, the most recently created schedule wins.

Common priority conventions:

- **0–10** — default content, daily announcements
- **50** — special event overrides (pep rallies, guest speakers)
- **100+** — reserved for emergency-adjacent scheduling (don't use casually)
- **∞** — emergency alerts (bypass schedules entirely — nothing overrides them except an all-clear)

## Preview before scheduling

From any playlist detail page, click **Preview** to see a 1:1 render of what the playlist looks like on a 1080p display. This runs entirely in your browser — no screens are affected.

## Scheduling tips

- **Don't stack too many schedules** on one screen. If you have more than 3 overlapping schedules, it becomes hard to reason about what's showing. Consolidate into a single playlist with internal day-of-week rules instead.
- **End-date everything**. Open-ended schedules accumulate over years and eventually confuse everyone. Use a one-school-year end date by default.
- **Test schedules against a test screen group** before rolling out district-wide. Easy to get the time zone wrong.
