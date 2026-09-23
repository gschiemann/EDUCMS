---
title: Menu boards + POS pricing
category: Integrations
updated: 2026-09-23
excerpt: Put a designed menu on screen in minutes — and bind it to your point-of-sale so prices update themselves (and sold-out items, where your POS reports them).
---

# Menu boards + POS pricing

A menu board should never show yesterday's price. VenueOS menu boards are designed screens that can pull live prices straight from your point-of-sale — and sold-out items too, where your POS reports them.

## Start with a designed board

Restaurant, bar, and cafe workspaces get a menu-board gallery out of the box — full-service menus, drive-thru boards, tap lists, wine lists, brunch and bakery boards. Open **Templates**, pick one, hit **Customize**, and every section, item, price, and photo is editable in the side panel.

No POS? Stop here — edit prices right in the panel and you still have a beautiful, instantly updatable menu.

## Connect your point-of-sale

1. Open **Settings → Point of Sale** and click **Connect**.
2. Choose your provider — **Toast**, Square, or **Clover** — and approve the connection in that provider's own sign-in window.
3. VenueOS pulls your menu catalog. You'll see it listed with a healthy/attention status right on the settings card.

## Bind the board to live data

In the builder, a menu zone has a **menu source** picker:

1. Choose your connected POS (instead of manual items).
2. Map each board section to a POS category (Entrées, Draft Beer, Combos…).
3. Prices now render from the POS — change a price in your POS and the screen follows (see *How fast* below).
4. **Sold-out items**: Square reports them on its own — 86 an item there and it greys out (or drops off) on screen. Toast, Clover, Lightspeed and Shopify don't report sold-out items: 86 the item in **Menu** instead, and every screen follows.

## Boards the AI builds from your POS menu

Ask the AI Concierge for a menu board and, with a POS connected, it offers to use your POS menu. Pick the sections and every row of the board it makes is bound to its POS item — by the item itself, not by its name. On screens those rows follow the POS: a new price or a renamed item shows up on its own, a sold-out item reads **Sold out** (where your POS reports it), and an item removed from the POS reads **Not available**. In the builder, the **Live menu** section shows which rows are bound and anything that needs you.

## How fast changes reach the screens

- **Square** — within about a minute.
- **Toast** — about 5 minutes after you publish the menu in Toast.
- **Clover, Lightspeed, Shopify** — within the hour (they sync hourly), or right away with **Sync now** in Settings → Point of Sale.

Screens pick up each sync within 30 seconds. A screen that loses its connection keeps showing the last prices it received; one that restarts while offline shows the prices saved in the board until it reconnects.

## Per-location menus

Multi-location groups can override any item's price or availability per location — the same board design serves every store with each store's real prices.

## Dayparts and happy hour

Use **Playlists + Schedules** to rotate boards by time of day: breakfast until 10:30, lunch after, the happy-hour board weekdays 3–6. The schedule flips the board; the POS keeps the prices honest.
