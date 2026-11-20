# 2026-11-19: DOMPurify 3.4.18, and what the scheduled follow-up found

A scheduled check-in of the lead's own (set on 2026-11-18, fired 2026-11-20T01:30Z, Thursday evening Central) carried three follow-ups: Chromium in the two images, DOMPurify 3.4.18, picomatch. This is the record. Times are UTC.

## What this pull request changes

- `dompurify` 3.4.17 to 3.4.18: the root override becomes `dompurify@<3.4.18 -> 3.4.18` (exact), `apps/web/package.json` asks for `3.4.18`, and the lockfile moves the one package. `isomorphic-dompurify` 3.8.0 in the API resolves the same copy through the override.
- Nothing else. No source file changes.

Why now: the 2026-11-17 patch sweep deferred it because it was three days old; the rule is five. It was published 2026-11-14T14:18Z and is still the newest 3.x.

What 3.4.18 fixes, from its release notes: a `SAFE_FOR_TEMPLATES` bypass, a direct property read in the clobbering check, a hook-widened allow-list carrying over, and a new console warning when `USE_PROFILES` is combined with `ALLOWED_TAGS` or `ALLOWED_ATTR`. No advisory is published against 3.4.17 (npm bulk advisory endpoint, 2026-11-20). The release is not small: the CommonJS build differs from 3.4.17 by 267 lines out and 181 in (2,540 lines to 2,454), most of it the refactor its notes mention, which is why the side-by-side run below was worth doing.

## A correction to the 2026-11-17 note

That note said "our five call sites use only `USE_PROFILES: { svg, svgFilters }`". There are six:

| Call site | Options |
|---|---|
| `apps/web/src/components/layout/BrandMark.tsx` | svg profile, `FORBID_TAGS` |
| `apps/web/src/components/settings/BrandingSettingsCard.tsx` | svg profile, `FORBID_TAGS` |
| `apps/web/src/components/branding/BrandingLivePreview.tsx` | svg profile, `FORBID_TAGS` |
| `apps/web/src/components/branding/BrandingWizard.tsx` | svg profile, `FORBID_TAGS` |
| `apps/api/src/branding/sanitize-svg.ts` (through `isomorphic-dompurify`) | svg profile, `FORBID_TAGS`, `FORBID_ATTR` |
| `apps/web/src/lib/sanitize-html.ts` (`sanitizeWidgetHtml`, nine widget files) | **default profile** |

None sets `SAFE_FOR_TEMPLATES`, a hook or `IN_PLACE`, and none combines `USE_PROFILES` with an allow-list, so the new warning does not fire. The clobbering-check fix is the one change that applies to every call.

## Evidence

- Both builds side by side (`dompurify@3.4.17` and `dompurify@3.4.18` from `node_modules/.pnpm`, jsdom 29.0.2, the three option sets above, 62 inputs each: ordinary logos, event handlers, script and style, `foreignObject`, `javascript:` links, `use` and `animate` tricks, namespace confusion, clobbering forms, template expressions, entity games, and ordinary rich text): **186 runs, 186 identical outputs, no console warning in either build**.
- That run also shows something that is the same in both builds and is not changed here: a `style` attribute keeps its value, so `style="fill:url(javascript:...)"` survives the svg profile. No current browser runs a `javascript:` URL from CSS, so it is inert; it is written down so nobody rediscovers it as a regression.
- Web: the six suites that render a logo through the real sanitiser, 50 tests, pass, including "strips a script out of a hostile inline SVG". `tsc --noEmit` on the web app is clean.
- API: the 20 branding suites, 445 tests, pass (they replace `isomorphic-dompurify` with a stand-in, so they prove nothing about the bump); loaded directly, `isomorphic-dompurify` reports dompurify 3.4.18 and cleans a hostile sample with the API's own options.
- The advisory gate: critical 0, high 0, moderate 2 (glob, minimatch, unchanged, they do not gate).

## pnpm 10 rewrites the lockfile when an override changes. Read this before the next override.

This is the first override change since the installer moved to pnpm 10.34.9 on 2026-11-18. `pnpm install --no-frozen-lockfile` did not produce a one-package diff: it re-resolved the whole graph and wrote **256 insertions and 38 deletions**, among them:

- a `libc:` field on several dozen prebuilt-binary packages (new metadata, harmless);
- shorter peer suffixes on the `@nestjs/*`, `@sentry/nestjs` and eslint entries (format);
- **optional peers that pnpm 9 linked and pnpm 10 does not**: `proxy-agent` drops out of `@puppeteer/browsers` and `puppeteer-core`, `@typescript-eslint/parser` drops out of the `eslint-config-next` tree;
- a second `jest` / `ts-jest` / `jest-config` tree resolved against `@types/node` 24.12.2.

None of that belongs in a patch-level pull request, and the optional-peer changes touch the renderer's dependency closure. So the lockfile here was edited by hand to the seven lines that name dompurify (the override key, the web importer's specifier and version, the package entry with the registry's integrity hash, the snapshot key, and the one line under `isomorphic-dompurify`), and then checked the way CI checks it: `pnpm install --frozen-lockfile --lockfile-only` accepts it, and a frozen install fetches the tarball and verifies the hash. The integrity value is the registry's own (`npm view dompurify@3.4.18 dist.integrity`).

What the next model should do: either keep editing override bumps by hand in this way, or make the full pnpm 10 re-resolution its own pull request, read line by line, with the renderer image booted before it merges. Do not let it ride along with a security patch.

## Chromium in the two images: still waiting on Alpine

- CVE-2026-125350 (use after free in XML, exploited in the wild, on the CISA list with a 2026-11-24 date) is fixed in 157.0.8103.50 and, on the extended stable line, in 156.0.8078.96.
- A fresh build of the API image at 2026-11-20T01:33Z (the "Docker build + boot smoke test" job of Deploy Reliability run 44384016627, attempt 3) still installed `chromium 156.0.8078.79-r0` from Alpine 3.24. Alpine edge had 157.0.8103.50-r0 when it was read on 2026-11-19.
- **Correction to the probe:** "fixed" is 157.0.8103.50 or newer, **or** a 156 build at 156.0.8078.96 or newer. The earlier check-ins looked only for 157 and would have missed a 156 backport.
- Nothing was changed. The choices are the owner's: wait for Alpine 3.24, or a reviewed change that installs chromium from edge into a 3.24 image (mixing branches can pull edge versions of shared libraries, so it needs the renderer booted and a render compared before it ships).

## picomatch: the advisory was withdrawn

GitHub withdrew GHSA-fc5q-39xc-vjpf on 2026-11-18 at 15:38Z as "not a security issue". The npm bulk endpoint no longer returns it for 4.0.7 or 2.3.2, and the gate reads high 0 without using the waiver. The waiver entry in `scripts/npm-advisory-audit.cjs` and its proof are now inert and lapse on 2026-12-17; nothing has to be pinned and nothing has to be extended. Removing the entry means rewriting the gate's tests, which use it as their fixture: a tidy-up for the next change to that script, not a patch.

## GitHub moved `ubuntu-latest` to Ubuntu 26.04, and two of our jobs cannot install a browser there

- GitHub's changelog of 2026-09-17 says the label migrates between 2026-10-19 and 2026-11-19. Playwright 1.59.1, which this repository pins, does not know Ubuntu 26.04 (checked in the published `playwright-core` packages: 1.59.1 and 1.60.0 do not name `ubuntu26.04`, 1.61.0 of 2026-06-15 does; the newest is 1.65.1): `playwright install --with-deps` ends in "Playwright does not support chromium on ubuntu26.04-x64".
- Five browser jobs are already pinned to `ubuntu-24.04` (the first on 2026-08-18, for a different reason: WebKit hung on the rolling image) and are unaffected, the two required Emergency path checks among them. Two were left on `ubuntu-latest`: `prod-smoke.yml` job `prod-smoke` and `a11y.yml` job `axe`. Their scheduled runs failed on 2026-11-19 (15:15Z and 16:39Z; issues #339 and #340) and will fail on every run until they are pinned or Playwright is raised.
- The fix is two lines, in a pull request of its own, and it is a CI/CD definition: it waits for the owner's written go. Until it merges, the Chromium half of Prod Smoke cannot run on `master`, on a schedule or after a merge. The WebKit half is pinned and runs.
- Raising Playwright past 1.61 is the real fix and its own piece of work: it changes the browser builds under every end-to-end suite, including the two Emergency path checks.

## Unverified

- Nothing in this pull request was looked at on glass or in a browser by a person.
- The lockfile was edited by hand; the proof that it is right is pnpm's own frozen install, here and in CI, not a diff produced by pnpm.
