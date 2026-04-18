---
title: Getting started with EduSignage
category: Getting Started
updated: 2026-04-16
excerpt: A 10-minute walkthrough from creating your tenant to showing content on your first screen.
---

# Getting started with EduSignage

Welcome! This guide will get your first screen running in about 10 minutes. You'll create an account, add a screen, and schedule a playlist.

## 1. Create your school account

Go to **edusignage.app/signup** and sign up with your `.edu` or district email. Your account becomes a *tenant* — a workspace that holds every screen, template, and user for your building. If you're a district, a SUPER_ADMIN or district admin can add child schools under your district tenant later.

You'll be assigned the **SCHOOL_ADMIN** role by default when you sign up yourself. Admins invited later start as **CONTRIBUTOR** and can be upgraded.

## 2. Add your first screen

From the dashboard, click **Screens → Add screen**. You'll get a 6-character pairing code.

On the actual display — a Chromebook, Fire TV, smart TV browser, or Raspberry Pi — open `edusignage.app/player` and enter that pairing code. The screen is now bound to your tenant. Once paired, it will show your default template until you schedule something else.

If you have more than a few screens, create **Screen Groups** (e.g. "Main Hallway", "Cafeteria") so you can target them with a single schedule instead of one-by-one.

## 3. Pick a template (or build one)

EduSignage ships with **17 system templates** covering every common layout:

- Welcome boards, info boards, tri-zone hallways
- Cafeteria menus, bell schedules, bus boards
- Ticker displays, countdowns, daily digests
- Emergency alert templates (pre-configured for speed)

Open **Templates** in the sidebar, hover any template, and click **Use as starting point**. This creates a custom copy you can rename, recolor, and rearrange — the system template stays untouched.

## 4. Schedule it

Go to **Schedules → New schedule**, pick your template (or a playlist), and choose:

- **Where**: a single screen or a screen group
- **When**: date range, days of week, time range
- **Priority**: higher priority overrides lower on the same screen

Hit **Save**. Your screens will pick up the schedule within seconds via our real-time WebSocket channel — no need to reboot displays.

## 5. Next steps

- Invite colleagues under **Settings → Users**
- Enable SSO with Google or Microsoft — see [the SSO guide](/help/sso)
- Read the [emergency system overview](/help/emergency-system) before giving anyone panic-trigger access

Stuck? Email support@edusignage.app and a human will get back to you within one school day.
