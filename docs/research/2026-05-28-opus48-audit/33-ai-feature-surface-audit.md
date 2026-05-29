# AI Feature Surface Audit (§4)

> Opus 4.8 read-only, 2026-05-29. Every AI surface traced to real callers + render sites.

## Verdict
"Not one AI function is usable" = TRUE in prod (no key set), FALSE about the code. **5 AI
features are genuinely WIRED front-to-back and light up the instant a key is added.** The
fakery is ONE cluster: the Integration Concierge (marketed "AI-driven" but not AI + no UI).

## Master table
| AI feature | Status | Mount/endpoint | Key tier | Reachable? |
|---|---|---|---|---|
| Sparkle copy-gen | **WIRED** | `AiGenerateButton.tsx:103`; mounted 4× `PropertiesPanel.tsx:1655,1741,1959,3984`; API `ai.controller.ts:49`→`ai.service.ts:360` | BYOK/Platform | Yes (builder text zones) |
| Touch-template gen | **WIRED** | `templates/page.tsx:662`+modal; `templates.controller.ts:845`→`ai.service.ts:631` (SSRF-guarded, persisted) | BYOK/Platform | Yes (admins) |
| AI alt-text | **WIRED** | auto `assets.controller.ts:177` + manual `:1017` + UI `assets/page.tsx:1251`; `ai-alt-text.service.ts:266` (OpenAI 4o-mini→Anthropic Haiku vision) | BYOK/Platform | Yes (image assets) |
| BYOK key config | **WIRED** | `AiProviderRow`→`/settings/ai` `AiKeyCard`; `ai-key.controller.ts`; AES-256-GCM | n/a | Yes (admins) |
| Bug auto-analyzer | **WIRED** | auto `bugs.controller.ts:395` + SUPER_ADMIN UI `super/bugs/[id]`; `bug-analyzer.service.ts:628` | **Platform ANTHROPIC only** | Yes (SUPER_ADMIN) |
| **Integration Concierge discover/describe** | **COSTUME + NOT AI** | `integrations.controller.ts:72,90`→`discovery.service.ts:404,438` = **pure regex, 0 AI calls**; **0 web callers** | none | **NO** |
| Concierge explainer / diagnostic / build-for-me / onboarding step | **NOT-BUILT** | 0 files | — | No |
| Auto-celebration | WIRED but **NOT AI** (score-delta rules, no ML) | `sports.service.ts` | n/a | Yes (sports) |
| Branding "theme from logo" | **NOT AI** (cheerio/postcss scrape) | `branding-scraper.service.ts` | n/a | works, not AI |
| Image gen / bg-removal / translation / TTS / voice-to-text / anomaly | **NOT-BUILT** | 0 files each | — | No |

Provider dispatch (`ai-providers.ts`) real for all 3 (Anthropic/OpenAI/Google), 15s AbortSignal, shared `mapProviderQuotaError`, 3-tier catalog. Production-grade.

## Where we CLAIM AI but ship nothing (ranked)
1. **Integration Concierge — double-fake** (HIGH): `/discover`+`/describe` exist but ZERO web callers (orphan), AND `discovery.service.ts` is regex not AI. Explainer/diagnostic/build-for-me/onboarding = unbuilt. This is the justified part of the complaint.
2. Branding "AI theme from logo" — deterministic scrape, marketed AI-adjacent.
3. Auto-celebration billed as AI tool — plain conditionals.
4. The §4 "if/when built" tail (image/bg/translation/TTS/voice/anomaly) — honestly unbuilt, not surfaced (roadmap, not costume).

**Clean:** public landing/marketing has NO AI claims (no "AI"/"Claude"/"magic"/"smart" copy) — no customer-facing vaporware; AI claims live only in CLAUDE.md + in-product.

## Honest count
- **WIRED, real-AI, one env-var from working: 5** (sparkle, touch-template, alt-text, BYOK, bug-analyzer).
- **COSTUME: 1 cluster** (Concierge) + 2 mislabeled-as-AI-but-work (auto-celebration, branding scrape).
- **NOT-BUILT: ~8.**

Residual functional gap (narrow, real): alt-text has no Google/Gemini vision (`ai-alt-text.service.ts:16`) → a Google-BYOK tenant gets sparkle/touch-gen but silently no alt-text.

## Actions to kill the complaint
1. Set `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY` for cheap alt-text) on the API service → all 5 real features live.
2. Concierge: build the UI + wire to a real LLM, OR stop calling it "AI."
