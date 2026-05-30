# App-wide editability sweep (2026-05-29)

Operator: *"i ned to be able to edit every fucking template like this and
upload logos when needed or images....audit and fix the basic ass shit
across the app like this."*

## Architecture (how editing works — confirmed)
Two editability paths in the builder:
1. **Hand-built `case '<TYPE>'`** in `PropertiesPanel.tsx` — core signage +
   RETAIL_* + restaurant/bar + HS pack + a few animated. Explicit
   TextField / AssetPickerField / ListItemsEditor / ColorPickerField per key.
2. **Generic auto-form** — for widgets with NO case (MS_*, most ANIMATED_*,
   themed bulletin/scrapbook/storybook, WORSHIP/HEALTHCARE/HOSPITALITY/
   CORPORATE/CHART/CELEBRATION). Reads the widget's registered `defaults`
   and generates a field per key: string→TextField, number→TextField,
   bool→ToggleField, array→list, **image-named key→AssetPickerField (upload)**.
   So a widget is fully editable IFF its `defaults` lists every text + image,
   and the component renders each from config.

## Central lead fix (commit 224c410, LIVE)
Generic auto-form now renders **image/logo/photo content keys as
AssetPickerField (upload from desktop + Assets + URL)** instead of a
paste-only URL TextField — single (`AssetPickerField`) + array galleries
(`AssetListPickerField`). Suffix-anchored `isImageKey` so text fields
(`imageCaption`, `logoText`) stay text. One change → image upload on every
generic-edited widget.

## Toolbar consolidation (commit 5d4613e)
Operator: *"i dont want a tool bar on a tool bar ... integrate anything
useful into the bottom tool bar and dump the rest."* TopContextToolbar now
returns null for IMAGE/VIDEO; the bottom floating pill gained Fit / Opacity /
Corner-radius for media; VideoWidget wired to honor fit/opacity/borderRadius.

## Agent fleet (one widget family each, worktree-isolated; lead merges)
| Family | Branch | Status | What it fixed |
|---|---|---|---|
| Animated school | worktree-agent-a54e2c06a7b706a0f | ✅ back | themed-widget-defaults.ts — added weekMenu arrays, tickerMessages, chefPhotoUrl image keys across cafeteria/bell/bus/hallway/main-entrance/morning-news/achievement |
| MS themed pack | worktree-agent-af6294f1d6f687ece | ⏳ running | |
| HS themed pack | worktree-agent-a240104c0961bddd3 | ⏳ running | |
| Bulletin/Scrapbook/Storybook | worktree-agent-a41fabc900fb89799 | ✅ back (68bfbf4) | added logoImageUrl/photoImageUrl/polaroidImageUrl → auto-upload |
| Fitness pack | worktree-agent-a714b57b90c8d2609 | ⏳ running | |
| Restaurant + Bar | worktree-agent-a32d809f4cd56016a | ✅ back (8d12ae5) | MenuBoardWidget emoji→photo thumbnail |
| Retail + verticals | worktree-agent-a703205a545032b9b | ✅ back | v2/registry.ts — completed WORSHIP/HEALTHCARE/HOSPITALITY/CORPORATE defaults |

## LEAD PROPERTIES-PANEL PUNCH-LIST (case-having widgets with field gaps)
These need PropertiesPanel.tsx edits (lead-owned) — agents reported, didn't touch:

**Restaurant/Bar (a32d):**
- RESTAURANT_SPECIALS_CALLOUT — add `imageUrl` AssetPickerField + render featured-item photo (interface needs `imageUrl?`).
- RESTAURANT_MENU_BOARD — rename item field key `emoji`→`imageUrl` for clarity (works today); add `bgColor` ColorPickerField.
- BAR_COCKTAIL_MENU — optional per-cocktail `imageUrl` (nice-to-have).
- BAR_EVENT_TONIGHT — optional artist/performer photo `imageUrl` (nice-to-have).

**Animated school (a54e) — structured-array editors missing:**
- ANIMATED_BUS_BOARD — `routes[]` ({num,dest,stops,eta,etaUnit,late}) needs a list editor.
- ANIMATED_MORNING_NEWS — `stories[]` ({category,title,time}) "Up Next" cards need a list editor.
- ANIMATED_ACHIEVEMENT_SHOWCASE — `leftHonors[]`/`rightHonors[]`/`stats[]` need name-list editors.
- ANIMATED_WELCOME _HS/_MS — `logoEmoji` emoji-fallback text field (minor).

**Retail (a703):** none (all 7 RETAIL_* cases complete). Dead config: RETAIL_PRODUCT_GRID `showSaleBadges` toggle references a non-interface key (harmless).

**Bulletin/Scrapbook/Storybook (a41f):** none — all flow through the auto-form.

> Update this table as MS / HS / Fitness agents return.
