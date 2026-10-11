---
title: Getting started with VenueOS
category: Getting Started
updated: 2026-10-11
excerpt: A 10-minute walkthrough from creating your workspace to showing content on your first screen.
---

# Getting started with VenueOS

Welcome! This guide will get your first screen running in about 10 minutes. You'll create an account, pair a screen, and schedule a playlist.

## 1. Create your workspace

Go to **venue-os.app/signup** and sign up with your work email. Pick your **industry** — school, restaurant, gym, sports venue, retail, office, and more — and VenueOS tailors the templates, categories, and defaults to your world (see the *Industries* guide). Your account becomes a *workspace* that holds every screen, template, and user for your location; groups with multiple locations (a district, a chain, a franchise) can add child locations under a parent later.

You'll be the admin of your workspace when you sign up yourself. Teammates you invite later start as **Editors** by default and can be upgraded (see *Inviting staff and assigning roles*).

## 2. Add your first screen

The code comes from the **screen**, and you type it into the dashboard:

1. On the display, start the VenueOS player. On an Android display or media player that is the player app; on a Chromebook, PC, smart TV browser or Raspberry Pi, open `venue-os.app/player`. The screen shows a 6-character pairing code.
2. In the dashboard, open **Screens**, click **Pair Screen**, and enter that code (or scan the QR code on the screen with your phone). Give the screen a name and click **Pair**.

The screen is now bound to your workspace. Once paired, it shows your default content until you schedule something else. See [How to pair a new screen](/help/pair-a-screen) for the details.

If you have more than a few screens, create **Screen Groups** (for example "Front Entrance" or "Dining Room") so you can target them with a single schedule instead of one-by-one.

## 3. Pick a template (or build one)

VenueOS ships with a large library of ready-made templates, and **each industry gets its own gallery** designed for it — a restaurant sees menu and promo boards, a gym sees class and training boards, a sports venue sees scoreboards, a school sees welcome and schedule boards, and so on. Across all industries the catalogue is 480+ layouts plus 280+ ready-made boards, and your gallery opens on the set for your workspace's industry.

Open **Templates** in the sidebar, click any template to preview it, then click **Customize**. This creates a copy you can rename, recolor, and rearrange — the ready-made original stays untouched.

## 4. Schedule it

Go to **Schedules → New schedule**, pick your template (or a playlist), and choose:

- **Where**: a single screen or a screen group
- **When**: date range, days of week, time range
- **Priority**: higher priority overrides lower on the same screen

Hit **Save**. Your screens will pick up the schedule within seconds via our real-time WebSocket channel — no need to reboot displays.

## 5. Next steps

- Invite colleagues under **Settings → People & access**
- Enable SSO with Google or Microsoft — see [the SSO guide](/help/sso)
- Read the [emergency system overview](/help/emergency-system) before giving anyone panic-trigger access

Stuck? Email support@venue-os.app and a human will get back to you within one business day.
