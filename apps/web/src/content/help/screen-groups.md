---
title: Organizing screens with screen groups
category: Screens
updated: 2026-04-16
excerpt: Target dozens of displays with one schedule by grouping them by location or purpose.
---

# Organizing screens with screen groups

Once you have more than about five screens, managing them individually gets painful. **Screen Groups** let you bundle screens together so a single schedule hits all of them.

## When to create a group

Create a group whenever you'd otherwise repeat the same schedule across multiple screens. Common groupings:

- **By location**: "Main Hallway", "Cafeteria", "Gym Lobby"
- **By audience**: "K–2 Classrooms", "Staff-Only Areas"
- **By purpose**: "Emergency-Capable Displays" (excludes classroom TVs from alerts)

A screen can only belong to one group at a time.

## Creating a group

1. Go to **Screens → Screen Groups → New group**.
2. Name it and add a description.
3. Drag screens into the group, or click individual screens and assign them.

## Using groups in schedules

When creating a schedule, the **target** picker offers three options:

- **Tenant** — the entire school (for school-wide playlists)
- **Group** — a single screen group
- **Screen** — one specific screen

The emergency system uses the same scoping. Triggering an alert at `scopeType: 'group'` pushes the alert only to screens in that group. This is how you exclude, say, early-childhood classrooms from a lockdown alert that might scare young kids, while still alerting all the hallway screens.

## Permissions

Screen groups inherit tenant-level permissions. A CONTRIBUTOR can assign screens to groups but cannot create or delete groups — only SCHOOL_ADMIN and above can.
