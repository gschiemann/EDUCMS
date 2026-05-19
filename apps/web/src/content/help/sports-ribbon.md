---
title: Set up the stadium ribbon board
category: Sports
updated: 2026-05-18
excerpt: Configure what rides your LED ribbon — score, content, sponsors — and size it for a full-bowl wrap.
---

# Set up the stadium ribbon board

A ribbon (or fascia) board is a long, short LED strip. VenueOS drives it with a fixed **score zone** plus a rotating reel of content.

## Ribbon content

In **Set up → Ribbon content** you control what rides the reel:

- **Content presets** — toggle which content types appear (the game situation, crowd messages, the roster, sponsors, image slides).
- **Speed** — how fast the reel rotates: Slow, Normal, Fast, or Very fast.
- **Score** — how many times the scorebug repeats around the ribbon (see below).

## Custom messages

Under **Set up → Ribbon messages**, type your own lines — one per line — and they scroll in place of the default crowd prompts. Leave it empty to use the defaults.

## Ribbon images

Under **Set up → Ribbon images**, add full-bleed images — sponsor banners, welcome art — that fill the ribbon as the reel rotates.

## Score recurrence — for a full-bowl wrap

A straight ribbon along one wall needs the score in one place. A ribbon that **wraps the whole bowl** needs the score to repeat so it's readable from every seat.

The **Score** control sets how many times the scorebug repeats: **Auto** (sizes the count to the ribbon's width) or a fixed **1×–4×**. For a continuous full-bowl wrap, raise it so a fan anywhere in the venue can glance up and see the score.

## What resolution to make images

- **Scoreboard images** — 1920 × 1080.
- **Ribbon images** — match your ribbon's pixel canvas. Height in pixels = panel height (mm) ÷ pixel pitch (mm); width = total length (mm) ÷ pitch. A 1000 mm-tall, 45 ft ribbon at a 3.9 mm pitch is roughly **3500 × 256**. Author at that — or 2× for crispness, and let it scale down.

## See it

Open the ribbon at `/ribbon/<game-id>` in a browser, or push it to a screen — see [Put a game on your screens](/help/sports-screens).
