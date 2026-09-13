# Apps tab: audit and redesign handoff

Audited September 12, 2026, against committed source `e4e018bb`. This is the **Apps tab in the template builder** shown in the screenshot, not a new whole-product security certification. No production features were changed or deleted.

## Recommendation

Keep the useful capabilities; rebuild their discovery and source-setup layer. **19 tiles currently represent 15 configurable entries and four unimplemented entries, not 19 proven integrations.** Five provider tiles use a static web path that cannot preserve their client-side live behavior. Input conversion and validation have reproducible defects.

- **Repair and retain 11 external-source entries:** YouTube, Vimeo, Twitch, Slides, PowerPoint, Canva, Sheets, Web Page, Maps, RSS, Calendar. Twitch and arbitrary Web Page belong under advanced/industry-specific discovery, not the school default.
- **Consolidate four native utilities:** QR Code, Clock, Countdown and Weather should use the existing Widgets setup/renderers, with contextual shortcuts where useful. Do not delete their capabilities.
- **Remove four unimplemented tiles from the main catalog:** Facebook Page, Instagram, Social Wall and Google Reviews. Preserve old identifiers/configurations. Keep a separate roadmap, with Social Wall as the possible future consolidated offering.

## Read in order

1. [Audit: every app, evidence and priorities](AUDIT.md).
2. [Design and implementation handoff](DESIGN-AND-IMPLEMENTATION.md).
3. [Reproduction instructions and limitations](evidence/README.md).

The interactive design shown in the conversation is a proposal using labeled example content. It is not a live connection, production screenshot, or an implemented fix.

## Verification result

77 tests passed across five suites: 37 new registry/form checks, 11 existing streaming checks, eight existing feed-renderer checks, 15 touch checks and six QR decoding checks. Some new tests intentionally assert the current defect to document its reproduction; a green audit run does **not** mean those defects are fixed. Four additional real-Chromium form checks reproduced three defects and confirmed the coming-soon guard, using mocked preview/store/API boundaries.

No authenticated deployed CMS session, provider-owned test accounts, real Taurus/LCD hardware or unattended playback soak was exercised. **No third-party app is certified end-to-end by this audit.** The handoff specifies the remaining release tests.
