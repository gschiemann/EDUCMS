# 2026-11-23: Spell check by default on the dashboard

The owner asked: "Can we apply like a spell check everywhere? Even when I'm typing like the screen group names...it would be great if it did some type of spell check that was just built in". The operator works from an iPhone (Safari) and from desktop Chrome and Safari.

Branch `claude/spellcheck-everywhere`, cut from `origin/master` 1292fd2879a9. The change is commit 5f2ac7592d4f; this handoff is the commit after it. Nothing was pushed.

## What changed

The spell check is the browser's own: no dictionary bundle, no network call, no AI. It underlines a misspelled word. It does not change what was typed. Autocorrect and autocapitalize are left exactly as each field declares them.

Before this change nothing turned spell check off globally, but the engines differ. Chrome and Safari check single-line text inputs and textareas on their own. Firefox checks only multi-line controls unless a field says `spellcheck="true"`. So for Chrome and Safari the default was already on for most fields. This change makes it explicit and the same on every engine, and turns it **off** where the value is not words.

1. **`apps/web/src/lib/spellcheck-default.ts`** (new). It has a pure `shouldSpellcheck(el)` and `installSpellcheckDefault()`. The installer adds one capture-phase `focusin` listener on `document`. When a free-text field gets focus and has no `spellcheck` attribute, on itself or inherited from an ancestor, the listener sets `spellcheck="true"`. The installer is reference-counted, so a Strict Mode double mount still leaves one listener. There are no timers, no polling and no per-field listeners.
   - Why React is unaffected: React writes only the attributes it rendered. A field rendered with `spellCheck={false}` already has the attribute, so the module never touches it. A field rendered without `spellCheck` has no attribute that React owns, so React never reads the new one back or warns about it. The listener is installed from an effect, after hydration. If a later render passes `spellCheck`, React's write wins.
2. **Mounted once, from `DashboardLayout`** (`apps/web/src/components/layout/DashboardLayout.tsx`, a `useEffect`). That layout is the chrome of every `/[schoolId]/*` page. The screen surfaces are separate routes outside it. In the fresh production build, no client-reference manifest under `.next/server/app/{player,board,ribbon,scorebug,overlay,pair}` references the installer's chunk, and dashboard pages such as `[schoolId]/assets` do. The e2e test also proves `/player` installs nothing.
3. **`EditableText.tsx`** (`apps/web/src/components/widgets/themes/EditableText.tsx`): spell check is now **on** in the in-canvas text editor. Those words go on screens, so a typo caught here never reaches the glass. The textarea exists only in edit mode. Edit mode needs `onConfigChange`, and only the template builder passes it, so no screen route renders the textarea.
4. **`<html lang>`** already follows the UI language: `I18nProvider` sets it when the language changes. A new jest suite pins that (`apps/web/src/i18n/__tests__/html-lang-follows-locale.test.tsx`). The root layout still server-renders `lang="en"`, and the provider corrects it after mount. This was already so before the change. It does not affect spell check, because a field is focused only after mount.
5. **`spellCheck={false}` on 57 fields** that hold codes, URLs, colours, CSS, IDs, keys, secrets, time zones, slugs or one-time codes (list below).

## The rules (`shouldSpellcheck`)

Spell check is turned on for:

- a `textarea`;
- an `input` with `type="text"` or no type;
- a `contenteditable` host (`""`, `true` or `plaintext-only`).

A field is skipped, and left exactly as it is, when any of these holds:

- It or an ancestor already has a `spellcheck` attribute. The existing and new `false` values stay off.
- It is inside `[data-no-spellcheck]`.
- It is `readonly` or `disabled`.
- It is an input whose type is anything but `text`: url, email, search, password, number, tel, date, colour and so on.
- It is an input with a `pattern` attribute, which constrains the value to a format.
- Its `inputmode` is `numeric`, `decimal`, `tel`, `email`, `url`, `search` or `none`.
  - `search` is skipped on purpose. A search or filter box holds query fragments, names and IDs. A typo there shows itself as "no results", and the text is never saved or put on a screen, so red underlines would be noise.
  - `none` means the field is driven by a picker or a keypad.
- Its `autocomplete` includes `email`, `username`, `url`, `tel` or `tel-*`, `one-time-code`, `current-password`, `new-password`, `postal-code` or any `cc-*` token.

## Fields set to `spellCheck={false}`

The line numbers are at commit 5f2ac7592d4f.

Dashboard pages (`apps/web/src/app/[schoolId]/…`):

| File:line | Holds |
|---|---|
| `assets/page.tsx:1440` | web-page asset URL |
| `screens/page.tsx:378` | pairing code (`#pair-code-input`) |
| `settings/branding/page.tsx:642` | brand colour hex (`#brand-hex`) |
| `settings/developer/page.tsx:784` | webhook POST URL |
| `settings/pos/WebhookSecretReveal.tsx:35` | issued webhook secret |
| `settings/pos/page.tsx:563` | Toast location list ("name \| restaurant GUID") |
| `settings/pos/page.tsx:712` | POS credential `Field`: keys, IDs, secrets, URLs. The display name passes `words` and keeps the default. |
| `settings/streaming/page.tsx:790` | streaming credential `Field`: same pattern, display name keeps the default |
| `sports/[gameId]/SponsorPanel.tsx:380` | sponsor colour hex |
| `sports/[gameId]/TeamAbbrevFields.tsx:70` | team abbreviation |
| `sports/[gameId]/page.tsx:6525` | dive code (`105B`) |
| `sports/[gameId]/page.tsx:7279` | celebration sound URL |
| `sports/[gameId]/page.tsx:8849` | spotlight photo URL |
| `sports/page.tsx:997` | team website URL |
| `sports/page.tsx:1047` | team logo URL |
| `sports/sponsors/page.tsx:403` | sponsor logo URL |
| `templates/page.tsx:5773` | background colour hex |
| `templates/page.tsx:5813` | background image URL |
| `templates/page.tsx:6342` | web-page widget URL |
| `templates/page.tsx:6581` | calendar feed URL |
| `templates/page.tsx:6625` | RSS feed URL |

Pages outside the dashboard layout, where the `false` applies on every engine:

| File:line | Holds |
|---|---|
| `apps/web/src/app/login/page.tsx:2205` | MFA or backup code |
| `apps/web/src/app/login/page.tsx:2300` | emailed sign-in code |
| `apps/web/src/app/login/page.tsx:2836` | MFA enrolment code |
| `apps/web/src/app/login/page.tsx:3106` | SSO organisation slug |
| `apps/web/src/app/signup/page.tsx:292` | account URL slug |
| `apps/web/src/app/super/customers/new/page.tsx:251` | customer account URL slug |

Components (`apps/web/src/components/…`):

| File:line | Holds |
|---|---|
| `apps/AppLibraryPanel.tsx:243` | "paste anything" box (a URL or embed) |
| `auth/CredentialSetupGate.tsx:471` | email setup code |
| `auth/EmailVerificationGate.tsx:156` | email verification code |
| `branding/BrandingWizard.tsx:676` | website URL |
| `branding/BrandingWizard.tsx:825` | logo URL |
| `branding/BrandingWizard.tsx:1198` | colour hex |
| `debug/LogViewer.tsx:151` | log tag filter |
| `screens/DisplayScheduleModal.tsx:643` | time zone (`America/Chicago`) |
| `settings/ChangePasswordCard.tsx:124` | hidden username field for password managers |
| `settings/MfaCard.tsx:300` | MFA verification code |
| `settings/people/PeopleAccessEditor.tsx:536` | invite accept URL |
| `settings/people/PeopleAccessEditor.tsx:616` | temporary password (shown as text) |
| `settings/people/PeopleAccessEditor.tsx:1158` | email code |
| `settings/people/PeopleAccessEditor.tsx:1219` | sign-in link URL |
| `settings/people/PeopleAccessEditor.tsx:1335` | re-sent invite accept URL |
| `settings/people/SsoSettingsEditor.tsx:146` | SSO `Field`: entity IDs, URLs, certificates |
| `settings/people/SsoSettingsEditor.tsx:483` | ACS URL |
| `settings/player/PlayerUpdatesPanel.tsx:602` | OTA window time zone |
| `super/customers/OneTimeLink.tsx:39` | one-time link URL |
| `template-builder/BackgroundPanel.tsx:504` | custom CSS gradient |
| `template-builder/BackgroundPanel.tsx:518` | solid colour hex |
| `template-builder/MediaSourcePicker.tsx:273` | custom HLS playback URL |
| `template-builder/MediaSourcePicker.tsx:288` | provider API key |
| `template-builder/MediaSourcePicker.tsx:298` | commercial licence number |
| `template-builder/PropertiesPanel.tsx:2150` | a property of kind `url` (conditional: only that kind is off) |
| `template-builder/PropertiesPanel.tsx:8022` | kiosk action target: URL, webhook or ID. It is off except for `request-help`, whose message title is words. |
| `template-builder/PropertiesPanel.tsx:10328` | CSS gradient (advanced) |
| `template-builder/PropertiesPanel.tsx:10697` | Advanced raw config JSON |
| `template-builder/PropertiesPanel.tsx:11060` | `ControlledUrlInput` (URL) |

Not touched on purpose: fields where people type words. That covers names, titles, descriptions, messages, announcements, ticker text, and playlist, screen, group and template names. The 15 pre-existing `spellCheck={false}` fields are also unchanged, except `EditableText`, which is now on.

## Gates

All runs were on the branch head 5f2ac7592d4f, against base 1292fd2879a9, in this sandbox (16 GB, 4 CPUs), one heavy command at a time.

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile --lockfile-only` (pnpm lockfile drift) | pass |
| workspace packages build (`api-types`, `scoreboard-cts`, `signage-design`) | pass |
| web `tsc --noEmit` | pass, 0 errors |
| web production build (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`, 4 GB heap) | pass |
| `check-bundle-budget` | pass: 2,180 chunks, 20.00 MB, largest 0.84 MB |
| `check-sw-shell`, `check-help-prerender`, `check-brand-contrast`, `check-csp-prerender` (the rest of the Web typecheck + build job) | pass |
| web jest, full suite (`--ci --maxWorkers=3`) | pass: 714 suites, 10,511 tests |
| `check-i18n-parity` | pass (7,664 keys) |
| `pnpm mobile-perf-guard` | pass |
| `check-pill-rules` | pass (58 legacy, within baseline) |
| `check-inset-serialization` | pass (0 landmines) |
| taurus-safety workflow scripts: `check-taurus-safety`, `check-scene-css`, `check-variant-registry`, `check-board-editability`, `check-widget-truth`, `check-font-ceilings` | pass |
| `scripts/check-rulebook.cjs` | PASS |
| `check-request-budget` | OK |
| `check-schema-has-migration` | OK (schema unchanged) |
| eslint on the changed files | No new errors: 405 before and 405 after on the 33 modified files, all pre-existing. The four new files are clean. |
| e2e `tests/e2e/spellcheck-default.spec.ts`, Chromium | 1 passed |
| e2e emergency-path list from `emergency-path.yml` (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`), Chromium | 40 passed, 1 skipped. The skip is the existing Chromium `test.fixme` at `emergency-drill-paint-proof.spec.ts:383`, unchanged on master. |

How the e2e tests ran: the prebuilt server (`E2E_PREBUILT=1`, `CI=true`, one worker, port 3300). A scratch wrapper config outside the worktree changed only one thing: it pointed Chromium at the headless shell preinstalled in the sandbox. Nothing was installed.

The e2e test covers the owner's own example:
- The screen group name field gets `spellcheck="true"` on focus, and `element.spellcheck === true`.
- The group address field and the pairing code stay `false`.
- The optional screen name on the pairing form is on.
- `/player` installs nothing (a probe input there has no attribute after focus).

## What is unverified

- **WebKit, Safari and the iPhone.** There is no WebKit binary in this sandbox, so the e2e test skips WebKit (`test.skip(browserName !== 'chromium')`). Two things have not been seen on a real iPhone: the underlines, and whether a field that sets `autoCorrect="off"` still shows them. CI's webkit project should run the test; remove the skip once it passes there. That follows the repo's test-in-WebKit rule.
- **Firefox was never run.** Firefox is the only engine whose behaviour on most fields changes, because Chrome and Safari already checked single-line text inputs.
- **Which dictionary is used.** Chrome takes its dictionaries more from the user's browser language settings than from `lang`. Checking in Spanish or Chinese therefore depends on the operator's browser setup.

## Open items for the Lead

1. **Emergency confirmation inputs.** `apps/web/src/components/emergency/EmergencyTriggerModal.tsx` (the `confirmKey` input) and `apps/web/src/components/layout/EmergencyOverlay.tsx` (`#all-clear-input`) have no `spellcheck` attribute. The dashboard listener will therefore set `spellcheck="true"` on them at focus. The value and the confirm logic do not change, and Chrome and Safari already check those fields. Only Firefox changes: it may now underline the typed confirm word. They were left alone because they are life-safety CHANGE class. Decide whether to accept this, or to add `spellCheck={false}` to both under the life-safety review rules.
2. **A stale attribute on a reused node.** Once the listener writes `spellcheck="true"`, it stays for the life of that DOM element. Suppose React reuses the same `<input>` for a field that later becomes `type="url"`, `readOnly` or `pattern`, with `spellCheck` undefined on both renders: the `true` stays. The cost is an underline only. A data marker on the nodes the listener set, re-evaluated at each focus, would close it. The two conditional props in `PropertiesPanel.tsx` are not affected, because React writes `false` or removes the attribute there.
3. **Coverage outside the dashboard.** `/login`, `/signup`, `/onboarding`, `/super` and `/console` sit outside `DashboardLayout`, so Firefox gets no default there; Chrome and Safari check those pages natively. Add a second mount for `/super` and `/onboarding` if "everywhere" should include Firefox there.
4. **The branch is behind master.** `origin/master` moved to 8eb336396 (PR #345) after the base. `git merge-tree` shows a clean merge, with no conflicts; `DashboardLayout.tsx` is touched by both, in different hunks. The gates above ran on the branch, not on the merge. The ruleset's strict up-to-date rule will need an update-branch, and CI then checks the merge.

## Rollback

Revert the two commits. There is no schema change, no API change and no configuration. The listener has no kill switch of its own: removing the `useEffect` line in `DashboardLayout.tsx` turns it off, and every explicit `spellCheck` prop stays as written.
