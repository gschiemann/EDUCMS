---
title: Template design best practices
category: Templates
updated: 2026-04-16
excerpt: How to design signage that's readable from across the hall, not just across your desk.
---

# Template design best practices

Digital signage has different constraints than a poster or a web page. Here's what we've learned from hundreds of K-12 deployments.

## The 10-foot rule

Most hallway displays are viewed from 10+ feet away while students are walking past. Your content has about **2 seconds** to communicate.

- **Body text**: minimum 48pt at 1080p.
- **Headlines**: 80–120pt for real impact.
- **Pictures > words** whenever possible.

## Use templates consistently across a building

Pick one or two templates per building and stick with them. When students see the same layout every day, their eyes learn exactly where to look for bell schedules, the lunch menu, and announcements. Constant redesigns defeat the purpose.

## Color contrast

Aim for a contrast ratio of 7:1 between text and background (WCAG AAA for large text). Our brand indigo (#4f46e5) on white passes cleanly; light gray on white does not.

Avoid putting text on busy photographs without a semi-transparent overlay (`rgba(0,0,0,0.5)` is a safe default).

## Animations and transitions

- **Tickers** scroll at ~40 chars/sec. Faster feels jittery; slower feels sluggish.
- **Slide transitions** between playlist items: 0.5–1 second is the sweet spot. Avoid "cube" or "flip" transitions — they read as 2005.
- **Dwell time** per slide: 8–15 seconds for informational content, longer for announcements with lots of text.

## Portrait vs landscape

Portrait displays are great for bell schedules, staff spotlights, and wayfinding. Landscape is better for cafeteria menus, daily digests, and news tickers.

Don't just rotate a landscape template — it'll look cramped. Use a portrait-first template (e.g. "Hallway Portrait Display") and redesign specifically for vertical space.

## Emergency templates — don't customize the colors

The Emergency Alert templates use specific red/amber/blue color codes tested against state alert standards. If you rebrand them with your school colors, you risk students ignoring them in a real event. Leave them alone.

## Accessibility reminders

- Provide text alternatives for any critical information shown only as an image.
- Avoid flashing content faster than 3 Hz (photosensitive-epilepsy safe threshold).
- Captions on any video widget playing audio.
