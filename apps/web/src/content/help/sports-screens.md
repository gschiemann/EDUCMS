---
title: Put a game on your screens
category: Sports
updated: 2026-09-08
excerpt: Push the scoreboard, ribbon, or broadcast overlay to any paired display — one game per screen.
---

# Put a game on your screens

Once a game is set up, push it to your paired displays from the console.

## The three surfaces

A game can render three ways, and you pick per screen:

- **Scoreboard** — the full scoreboard: big score, clock, team panels, situational graphics.
- **Ribbon** — the LED ribbon or fascia board.
- **Off** — the screen returns to its normal scheduled content.

There's also a broadcast **scorebug** overlay for livestreams, served at `/scorebug/<game-id>`.

## Push a game to a screen

1. In the console, open the screen-push panel.
2. Every paired screen in your school is listed. For each one, tap **Scoreboard**, **Ribbon**, or **Off**.
3. The display switches within about a second.

## One game per screen

A screen can only be driven by **one game at a time**. If two game days run at once, each game manages its own screens — they can't both push to the same display.

If you push to a screen another game is already using, VenueOS asks first — *"Lincoln Field is showing Browns vs Raiders. Take it over?"* Confirm to switch that screen to your game, or pick a different one. This stops two operators from silently overwriting each other.

## Emergency override

An emergency alert outranks the game, always. Game content never takes precedence over a lockdown or weather alert: the emergency check runs first on every screen, scoreboard and ribbon alike, and it is never served from a cache. A screen that receives the alert switches to it and returns to the game when it clears. Delivery itself is the same path as any other alert — see the *Emergency system overview* for what it does and does not cover.

## When a game ends

A finished game keeps its screens until you delete it or tap **All off**. If a screen seems stuck on an old game, that's why — clear it from that game's console.
