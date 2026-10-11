---
title: Designing with AI
category: AI Studio
updated: 2026-10-11
excerpt: Describe a board in a sentence and pick from AI drafts, write copy with the sparkle button, and generate images — plus how AI keys and limits work.
---

# Designing with AI

VenueOS has four AI features. This guide covers what each one does, where to find it, and how AI keys and limits work today.

| Feature | Where | What it does |
|---|---|---|
| **Generate a board** | **Templates → Generate with AI** | Designs a complete, on-brand board from a sentence |
| **Edit with words** | On the generated drafts | Changes a board from a plain-English instruction |
| **Sparkle (writing help)** | Text fields in the template builder | Writes or rewrites copy in context |
| **Generate image** | **Assets → Generate with AI** | Creates a custom image and saves it to your library |

Only Admins and Super Admins can use Generate with AI on the Templates page. Nothing is ever published to a screen until you schedule it, so exploring is always safe.

## Generate a board

1. Open **Templates** and click **Generate with AI**.
2. Describe what you want, the way you'd tell a designer: *"a taco special board for Friday happy hour with our brand colors"*.
3. You get **two drafts** to compare. Open either one full-screen.
4. **Keep** the one you like. It lands in your template library, fully editable. Boards that suit a photo come back with a real, relevant photo already placed behind legible text.

Past generations are kept in a **history** list, so you can reopen an earlier set of drafts.

## Edit with words

On a generated draft, the **Edit with words** box changes the board from one plain-English instruction at a time — *"make the title bigger"*, *"use the brand color on the header"*. Short, single instructions work best. Review the proposed change, then **Apply** or **Discard**.

## The sparkle button

Text fields in the template builder have a sparkle button that writes or rewrites copy in context — announcement blurbs, menu descriptions, welcome messages. Each use offers a few options to pick from.

## Translate a whole board

**Translate** in the builder's top bar localizes every text field on the board in one pass — useful for bilingual venues and menus.

## Generate an image

In **Assets**, click **Generate with AI**, describe the image, and choose square, landscape or portrait. The result is saved into your media library like any other upload, and your brand colors and voice are woven into the prompt. Image generation needs an **OpenAI or Google key of your own** (see below) — Anthropic keys can write text but cannot make images, and image generation does not run on VenueOS's included AI. Without such a key, the dialog tells you to add one.

## How AI keys and limits work

**AI is included.** Boards and writing help run on VenueOS's AI at no extra charge, up to an allowance that scales with your number of screens and resets monthly:

- When you generate on the included AI, the dialog shows **how many boards you have left this month** and when they reset. Locations in the same organization draw from one shared pool.
- If you run out, you can **buy more boards**, or add your own AI key.

**Or bring your own key.** An Admin or Super Admin can add a key under **Settings → AI provider**:

1. Pick a provider — Anthropic, OpenAI or Google (each option shows where to get a key).
2. Paste the API key, choose a model, and click **Test & save**. We test the key before saving, so a typo fails here instead of later.
3. With your own key there is **no board limit** in VenueOS — you pay your provider directly, typically a few cents per full board and a fraction of a cent for text.

A location without its own key uses the one saved on its organization. Disconnecting a key puts that location back on the included AI. Hourly safety caps apply either way, so a runaway session can't surprise you.

If a feature isn't available to you (for example, you are not an Admin, or image generation without an OpenAI/Google key), the button or dialog says so and the rest of VenueOS works exactly the same.
