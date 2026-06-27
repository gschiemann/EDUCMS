# R4 — Best-in-Class AI Image Generation for Signage / Marketing Backgrounds + Graphics

**Date:** 2026-06-26
**Scope:** Compare the leading text-to-image models for the SIGNAGE / digital-board use case (backgrounds, branded graphics, kiosk scenes), grade them on the dimensions that matter for a board (legible text-in-image, brand-color adherence, logo/graphic styles, transparent PNGs, aspect-ratio control, speed, commercial safety), survey the value-added features leading tools ship beyond raw generation (bg-removal, upscaling, style presets, on-brand templating, coherent SETS), and make a concrete provider+feature recommendation for VenueOS.

> Context: VenueOS already wires gpt-image-1 + Imagen for AI image gen, but "the images aren't yet the prize." This report is about what makes signage imagery genuinely premium and which providers/features get us there.

---

## TL;DR recommendation (full detail at bottom)

- **Backgrounds / photoreal / abstract atmosphere** → **Google Imagen 4** (Fast for previews $0.02, Ultra for final $0.06; native 2K, cheap, fast). Keep **gpt-image-1** as the conversational/edit-with-context fallback.
- **Anything with TEXT baked in** (a poster headline, a "TACO TUESDAY $2" promo graphic, a menu hero) → **Ideogram 3.0** (best-in-class typography, ~90-95% text accuracy) or **gpt-image-1** as a no-extra-vendor fallback.
- **On-brand / repeatable / vector / icon-set / coherent multi-scene SET** → **Recraft V3/V4** (style-as-input, Brand Kit, Set tool, native SVG, transparent PNG, upscale). This is the differentiator that turns "a gradient" into "a designed board."
- **Commercially-safe / indemnified enterprise tier** (districts, big brands like the Domino's pilot) → **Adobe Firefly** (only major model with IP indemnification).
- **Add as platform features:** SET generation (matched multi-scene kiosk), brand-locked styles (hex + style refs), text-safe zones, one-click background removal, AI upscale to LED-native 2K/4K.

---

## 1. The models, head-to-head (signage lens)

### gpt-image-1 / GPT Image 2 (OpenAI) — *the generalist we already have*
- **Text-in-image:** Strong for a general model — one of only two proprietary models that keep low error rates on multi-line text up to ~800 chars; readable, well-positioned, style-adaptive — but still can struggle with precise placement/clarity. [OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation), [DataCamp GPT-Image-1 guide](https://www.datacamp.com/tutorial/gpt-image-1)
- **Transparent PNG:** Native `background: transparent` param — no manual cutout needed. Ideal for logos/stickers/drag-drop assets. [Civitai guide](https://education.civitai.com/civitais-guide-to-gpt-image-1/)
- **Aspect/size:** `1024x1024`, `1536x1024` (3:2 landscape), `1024x1536` (2:3 portrait); ratio also promptable. Limited fixed set — **no native 16:9 / 9:16 ribbon ratios**, which is a real gap for LED boards (you'd crop/outpaint). [OpenAI reference](https://developers.openai.com/api/reference/resources/images/methods/generate)
- **Quality knobs:** `quality` low/medium/high, `output_format` png/jpeg, `output_compression`.
- **Commercial:** Permitted under OpenAI usage policies; user owns output per OpenAI terms. **No IP indemnification.** [glbgpt commercial guide](https://www.glbgpt.com/hub/can-i-use-chatgpt-images-for-commercial-use-a-complete-guide-to-safe-use-in-2026/)
- **Signage verdict:** Great conversational/edit-in-context generalist, decent text, native transparency. Weakest on exact LED aspect ratios and not the prettiest backgrounds. Keep it as fallback + the "edit this with instructions" path.

### Google Imagen 4 (Fast / Standard / Ultra) — *best backgrounds-per-dollar*
- **Text-in-image:** Big jump over Imagen 3 — Ultra has "exceptional" text rendering (legible, correctly spelled, professional formatting); Standard "very good"; Fast "good." [MindStudio Imagen 4 Ultra](https://www.mindstudio.ai/blog/what-is-imagen-4-ultra-google)
- **Resolution:** Standard + Ultra native **2K up to 2048×2048**; Fast up to 1408×768. Matters for LED sharpness. [ThePlanetTools Imagen 4 guide](https://theplanettools.ai/blog/google-imagen-4-models-fast-standard-ultra-guide-2026)
- **Aspect:** **1:1, 3:4, 4:3, 9:16, 16:9** — proper landscape AND vertical-board ratios out of the box. [Gemini API Imagen docs](https://ai.google.dev/gemini-api/docs/imagen)
- **Speed/price:** Fast ~2.7s @ **$0.02**, Standard ~5-8s @ **$0.04**, Ultra ~10-15s @ **$0.06**. Fast is up to 10× faster than Imagen 3 — perfect for live preview. [ThePlanetTools](https://theplanettools.ai/blog/google-imagen-4-models-fast-standard-ultra-guide-2026)
- **Commercial:** Every Imagen 4 image carries an invisible **SynthID** watermark (regulatory disclosure friendly). Note: Imagen 3 has been **shut down** — must be on Imagen 4. [ThePlanetTools](https://theplanettools.ai/blog/google-imagen-4-models-fast-standard-ultra-guide-2026), [Replicate Imagen 4](https://replicate.com/google/imagen-4)
- **Signage verdict:** **Best default for board backgrounds.** Correct aspect ratios, native 2K, cheap, fast tier for preview + Ultra for final. This should be the primary background engine.

### Ideogram 3.0 / 4.0 — *the text-in-image champion*
- **Text-in-image:** The clear leader. Built from scratch with typography as a first-class output via a hybrid diffusion + dedicated typography-rendering system; **~90-95% text accuracy**; "text behaves like it was set in a design app." Default for any typography-heavy job. [MindStudio Ideogram V3](https://www.mindstudio.ai/blog/what-is-ideogram-v3), [Picasso IA](https://blog.picassoia.com/ideogram-3-best-ai-model-text-in-images), [pxz.ai review](https://pxz.ai/blog/ideogram-ai-review-2026)
- **Style/consistency:** Style Reference — upload up to 3 reference images OR pick a curated style; matches colors/textures/aesthetic across images for brand consistency. Character Reference for consistent subjects. [Ideogram Style Reference docs](https://docs.ideogram.ai/using-ideogram/features-and-tools/reference-features/style-reference)
- **Value-added ops in-API:** Generate, Remix, **Edit**, **Reframe** (outpaint to a new aspect), **Replace Background**, **transparent generation + background removal**, **Topaz upscaling**. [Ideogram API pricing](https://ideogram.ai/features/api-pricing)
- **Price:** Turbo $0.03 / Default $0.06 / Quality $0.09 per image. Transparent-gen w/ upscale $0.07-$0.23. Topaz upscale $0.12 (2K) / $0.24 (4K) / $0.48 (8K). [Puter Ideogram pricing](https://developer.puter.com/tutorials/ideogram-api-pricing/), [Ideogram API pricing](https://ideogram.ai/features/api-pricing)
- **Commercial:** Paid tiers grant commercial rights; **but no IP indemnity flows back to the customer** — indemnity flows user→Ideogram. For sensitive client/brand work, negotiate a bespoke commercial license. [AVB Ideogram 4 guide](https://aivideobootcamp.com/blog/ideogram-4-0-complete-guide-2026/)
- **Signage verdict:** Use it specifically when the **graphic must contain readable copy** (promo headline, "NOW HIRING," event poster, menu hero with price). Reframe is genuinely useful to retarget one design across landscape board + portrait poster + ribbon.

### Recraft V3 / V4 — *the on-brand design engine (our biggest differentiator)*
- **Style control:** "Thinks in design language." **Style is an INPUT to the model** (no retraining) — pick a set of brand images, tune a private style, and reuse it. 18+ output modes including vector-friendly illustration. [Recraft V3 launch](https://www.recraft.ai/blog/recraft-introduces-a-revolutionary-ai-model-that-thinks-in-design-language)
- **Brand Kit:** Upload brand colors / fonts / style references that persist across all generated assets — solves the "re-prompt the style every time" problem. [findtoolz Recraft](https://findtoolz.com/product/recraft-v3-brand-aware-ai-image-generator/), [MindStudio Recraft Studio](https://www.mindstudio.ai/blog/what-is-recraft-studio)
- **Coherent SETS:** **Set tool** — describe up to 6 images, get them all in one consistent style in one click. "Run 20 icon prompts and get a cohesive visual set, not 20 interpretations." This is exactly the "matched backgrounds for a multi-scene kiosk" capability. [Recraft image sets](https://www.recraft.ai/blog/how-to-create-image-sets)
- **Vector + transparent:** First API to produce **fully scalable SVG** (logos, icons, pictograms) plus PNG/JPG/PDF/TIFF/Lottie; native transparency. SVG = infinitely crisp on a 4K LED wall. [Recraft API blog](https://www.recraft.ai/blog/discover-the-power-of-recrafts-image-generation-api), [Replicate Recraft V3](https://replicate.com/recraft-ai/recraft-v3)
- **Upscale:** Creative Upscale adds texture/detail; crisp-upscale for restorative enlargement. [Recraft upscaler](https://www.recraft.ai/image-upscaler)
- **Text-in-image:** Renders readable in-image text at a level most models can't match (behind Ideogram but solid). [Recraft V3 launch](https://www.recraft.ai/blog/recraft-introduces-a-revolutionary-ai-model-that-thinks-in-design-language)
- **Commercial:** Full commercial rights + private only on **paid plans**; images generated on free/no-sub are public and carry NO commercial rights — and you don't retroactively own them by upgrading later. Must generate under a paid seat/API. [Recraft ownership FAQ](https://www.recraft.ai/blog/ownership-and-commercial-use-faq)
- **Signage verdict:** **The premium move.** Brand Kit + Set tool + SVG is precisely what turns AI imagery into a designed, on-brand, multi-scene kiosk look rather than a one-off gradient. Strongly recommend adding as the "on-brand graphics" engine.

### FLUX.1.1 Pro / FLUX.2 (Black Forest Labs) — *photoreal + brand-hex precision + open-weight option*
- **Quality/speed:** FLUX 1.1 Pro = pro-grade realism, 6× faster than 1.0 Pro; FLUX.1 Kontext = fast (3-5s) context-aware **editing** with strong character/style preservation across iterative edits. [MindStudio FLUX 1.1 Pro](https://www.mindstudio.ai/blog/what-is-flux-1-1-pro), [MindStudio FLUX Kontext Pro](https://www.mindstudio.ai/blog/what-is-flux-1-kontext-pro)
- **FLUX.2 (Nov 2025; klein Jan 2026):** **Up to 10 reference images** for character/product/style consistency; **exact hex-code brand-color matching** ("no approximation"); reliable text for infographics/marketing. Tiers: Pro (API), Flex, Dev (32B open weights), Klein (Apache-2.0, sub-second). [the-decoder FLUX.2](https://the-decoder.com/black-forest-labs-launches-flux-2-with-a-new-multi-reference-feature/), [BFL FLUX.2](https://bfl.ai/models/flux-2), [BFL blog](https://bfl.ai/blog/flux-2)
- **Commercial:** Pro/Flex via API for commercial; open-weight tiers (Dev license / Klein Apache-2.0) let you **self-host** — relevant if VenueOS ever wants to control cost/privacy at scale. No customer IP indemnity.
- **Signage verdict:** Strong dark-horse for **brand-color-exact** photoreal backgrounds + multi-reference product/sponsor consistency. The hex precision + 10-ref consistency rivals Recraft's Set idea. Consider as a secondary on-brand engine, or self-hosted Klein for cost control.

### Adobe Firefly — *the commercially-safe / indemnified tier*
- **The whole pitch:** Only major AI image generator offering **commercial IP indemnification** — Adobe accepts legal responsibility if a generated image is later found to infringe. Trained only on licensed Adobe Stock + public-domain + openly-licensed content (no scraped web). [Tensoria Firefly](https://tensoria.fr/en/tools/adobe-firefly-ai-commercial-images), [LicenseOrg indemnification](https://www.licenseorg.com/blog/adobe-firefly-indemnification-explained), [Adobe Firefly for business](https://business.adobe.com/products/firefly-business/firefly-ai-approach.html)
- **API:** Firefly Services API for developers; coverage extends to Photoshop/Illustrator Firefly outputs. Enterprise tier has higher indemnity caps ($50K+). [productgrowth Firefly review](https://productgrowth.in/tools/design/adobe-firefly/)
- **Signage verdict:** For risk-averse buyers (school districts, national brands like the **Domino's pilot**, anyone whose legal team asks "are these images safe to put on 150 screens?"), Firefly is the answer. Offer it as a "commercially-safe" toggle/tier rather than the default (it's pricier and less cutting-edge on raw aesthetics).

---

## 2. Capability matrix (signage-relevant)

| Capability | gpt-image-1 | Imagen 4 | Ideogram 3 | Recraft V3/V4 | FLUX.2 | Firefly |
|---|---|---|---|---|---|---|
| Legible text-in-image | B+ | B+ (Ultra A-) | **A (best)** | B+ | B+ | B |
| Brand-color adherence | C+ (prompt only) | B (prompt) | B (style ref) | **A (Brand Kit)** | **A (hex-exact)** | B+ |
| Logo / vector / icon styles | B (raster) | B | B | **A (native SVG)** | B | A- (Illustrator) |
| Transparent PNG | **A (native)** | C (no native) | A (native + bg-remove) | A (native) | B | A |
| Aspect-ratio control | C (3 fixed sizes) | **A (5 ratios incl 16:9/9:16)** | A (+ Reframe outpaint) | A | A | A |
| Speed | B | **A (Fast ~2.7s)** | A (Turbo) | B | A (Klein sub-1s) | B |
| Commercial safety / indemnity | C (no indemnity) | B (SynthID, no indemnity) | C (no customer indemnity) | B (paid-only rights) | B (open-weight option) | **A (full indemnity)** |
| Coherent multi-image SET | C | C | B (style ref) | **A (Set tool)** | A (10-ref) | B |
| In-tool bg-remove + upscale | edit API only | no | **A (Topaz upscale, bg-remove)** | **A (upscale)** | via Kontext edit | A |

---

## 3. What leading tools do BEYOND raw generation (the part that makes it "the prize")

1. **Coherent SET generation.** Recraft's Set tool (describe ≤6 images → one consistent style) and FLUX.2's 10-reference consistency are the killer feature for a **multi-scene kiosk / attract loop**: every scene shares palette, lighting, and motif instead of looking like 6 random stock images. [Recraft sets](https://www.recraft.ai/blog/how-to-create-image-sets), [the-decoder FLUX.2](https://the-decoder.com/black-forest-labs-launches-flux-2-with-a-new-multi-reference-feature/)
2. **On-brand style/Brand Kit.** Style-as-input + saved brand colors/fonts so the operator never re-prompts the look — generations come out matching the tenant's BrandKit automatically. [Recraft Brand Kit](https://findtoolz.com/product/recraft-v3-brand-aware-ai-image-generator/)
3. **Background removal + transparent gen** for clean overlays/logos/cutout subjects (gpt-image-1 native, Ideogram native, BiRefNet/Clipdrop as standalone). [Civitai](https://education.civitai.com/civitais-guide-to-gpt-image-1/), [fal BiRefNet v2](https://fal.ai/models/fal-ai/birefnet/v2)
4. **Upscaling** to LED-native res — Ideogram/Topaz (2K/4K/8K), Recraft Creative/Crisp upscale, Real-ESRGAN, Clipdrop (note Clipdrop got 30-40× more expensive post-Jasper acquisition). [Ideogram pricing](https://ideogram.ai/features/api-pricing), [letsenhance upscaler APIs](https://letsenhance.io/blog/all/best-upscaler-api/)
5. **Reframe / outpaint** to retarget ONE design across landscape board + portrait poster + ribbon strip (Ideogram Reframe; FLUX/Kontext edit). [Ideogram API pricing](https://ideogram.ai/features/api-pricing)
6. **Style presets / curated libraries** so a non-designer picks "neon," "watercolor," "corporate flat," etc. instead of writing a prompt (Ideogram styles, Recraft 18+ modes).
7. **Editing-with-context** (FLUX Kontext, gpt-image-1 edit) — "make the sky sunset, keep the building" iterative refinement with minimal drift. [arxiv FLUX.1 Kontext](https://arxiv.org/html/2506.15742v2)

---

## 4. What makes AI imagery genuinely PREMIUM on a signage board (vs a generic gradient)

- **Native target resolution + aspect.** Generate at the board's actual ratio (16:9 / 9:16 / ribbon) and upscale to 2K/4K so it's razor-sharp at 8-foot viewing distance. A scaled-up square crop is the #1 "looks cheap" tell. (Imagen 4 ratios + upscale.)
- **On-brand, not on-vibe.** Pull the tenant's BrandKit (primary/accent hex, logo, fonts) into every generation so the image reads as *their* board, not a stock template. Hex-exact engines (FLUX.2) + Brand Kit (Recraft) make this literal.
- **Text-safe zones.** Reserve where the operator's live widgets (clock, menu price, score) will sit and prompt the generator to keep that region clean/low-contrast — so dynamic text always stays legible over the AI background. (Implement as a prompt constraint + mask; no model does this automatically yet — it's our value-add.)
- **A coherent SET, not one image.** A premium kiosk attract loop has 4-6 scenes that obviously belong together. Set/multi-reference generation delivers that; one-off gen does not.
- **Legible baked-in typography** for the cases where text IS the graphic (promos, posters) — Ideogram-class quality so it doesn't look AI-garbled.
- **Vector for logos/icons/badges** so brand marks stay crisp at any LED size (Recraft SVG).
- **Clean cutouts** (transparent PNG / bg-remove) so a generated subject can sit over a brand color or live data.

---

## 5. Concrete recommendation for VenueOS

### Provider/model by job
| Job | Primary | Fallback / tier |
|---|---|---|
| Board **background** (atmosphere, abstract, photoreal) | **Imagen 4 Fast** for preview ($0.02), **Imagen 4 Ultra** for final ($0.06, 2K) | gpt-image-1 (already wired) |
| **Text-in-image** graphic (promo, poster, "NOW HIRING", menu hero) | **Ideogram 3.0** (Default $0.06) | gpt-image-1 |
| **On-brand** graphic / icon / badge / **vector logo** | **Recraft V3/V4** (Brand Kit + SVG) | FLUX.2 (hex-exact) |
| **Coherent multi-scene kiosk SET** | **Recraft Set tool** | FLUX.2 (10-ref) |
| **Commercially-safe / indemnified** (districts, Domino's-class brands) | **Adobe Firefly** | — (this is the safety tier) |
| **Background removal** | Ideogram bg-remove / gpt-image-1 transparent | BiRefNet (fal) standalone |
| **Upscale to LED-native** | Ideogram→Topaz (2K/4K) or Recraft upscale | Real-ESRGAN (Replicate) |

### Features to BUILD (in priority order)
1. **SET generation** — "Generate a matched set for this kiosk" → 4-6 scenes in one consistent style (Recraft Set or FLUX.2 multi-ref). This is the single biggest "now it's the prize" upgrade. (Maps to the existing multi-scene kiosk architecture, task #241.)
2. **Brand-locked styles** — auto-inject the tenant's BrandKit (hex primary/accent, logo, fonts) into every prompt/style-ref so output is on-brand by default; expose a "Use my brand" toggle. (Recraft Brand Kit pattern / FLUX.2 hex.)
3. **Text-safe zones** — let the operator mark where live widgets sit; constrain generation (prompt + mask) to keep those regions clean so dynamic text stays legible. (Our differentiator — no model does it natively.)
4. **One-click background removal** — for logos/subjects/cutouts (native transparent on gpt-image-1/Ideogram; BiRefNet as standalone op).
5. **AI upscale** to the board's native 2K/4K so generated imagery is sharp on big LED (Topaz via Ideogram, or Recraft upscale).
6. **Aspect-correct generation + Reframe** — generate at the board's real ratio (Imagen 4's 16:9/9:16) and offer Reframe/outpaint to retarget one design across landscape board + portrait poster + ribbon (Ideogram Reframe).
7. **Style presets** — a curated picker ("neon / watercolor / corporate-flat / retro-diner / stadium") so non-designers skip prompt-writing.
8. **Commercially-safe tier toggle** — route risk-averse tenants (districts, national brands) to Firefly for indemnified output; surface it as a trust feature.

### Licensing / safety notes to bake in
- Generate **only under paid API tiers** on Recraft/Ideogram or commercial rights don't attach. [Recraft ownership FAQ](https://www.recraft.ai/blog/ownership-and-commercial-use-faq)
- Imagen 4 stamps **SynthID** on every image (fine, even helpful for AI-disclosure compliance). [ThePlanetTools](https://theplanettools.ai/blog/google-imagen-4-models-fast-standard-ultra-guide-2026)
- Only **Firefly** offers customer-facing **IP indemnification** — make that the explicit selling point of a "safe" tier; the others do NOT indemnify the customer. [LicenseOrg](https://www.licenseorg.com/blog/adobe-firefly-indemnification-explained), [AVB Ideogram](https://aivideobootcamp.com/blog/ideogram-4-0-complete-guide-2026/)

---

## Sources
- OpenAI image generation guide — https://developers.openai.com/api/docs/guides/image-generation
- OpenAI create-image API reference — https://developers.openai.com/api/reference/resources/images/methods/generate
- DataCamp gpt-image-1 guide — https://www.datacamp.com/tutorial/gpt-image-1
- Civitai gpt-image-1 guide (transparency) — https://education.civitai.com/civitais-guide-to-gpt-image-1/
- glbgpt ChatGPT images commercial use 2026 — https://www.glbgpt.com/hub/can-i-use-chatgpt-images-for-commercial-use-a-complete-guide-to-safe-use-in-2026/
- Google Gemini API Imagen docs — https://ai.google.dev/gemini-api/docs/imagen
- MindStudio Imagen 4 Ultra — https://www.mindstudio.ai/blog/what-is-imagen-4-ultra-google
- ThePlanetTools Imagen 4 tiers/pricing — https://theplanettools.ai/blog/google-imagen-4-models-fast-standard-ultra-guide-2026
- Replicate Imagen 4 — https://replicate.com/google/imagen-4
- MindStudio Ideogram V3 — https://www.mindstudio.ai/blog/what-is-ideogram-v3
- Picasso IA Ideogram 3 text — https://blog.picassoia.com/ideogram-3-best-ai-model-text-in-images
- pxz.ai Ideogram review 2026 — https://pxz.ai/blog/ideogram-ai-review-2026
- Ideogram Style Reference docs — https://docs.ideogram.ai/using-ideogram/features-and-tools/reference-features/style-reference
- Ideogram API pricing — https://ideogram.ai/features/api-pricing
- Puter Ideogram API pricing breakdown — https://developer.puter.com/tutorials/ideogram-api-pricing/
- AVB Ideogram 4 guide (indemnity) — https://aivideobootcamp.com/blog/ideogram-4-0-complete-guide-2026/
- Recraft V3 launch — https://www.recraft.ai/blog/recraft-introduces-a-revolutionary-ai-model-that-thinks-in-design-language
- Recraft image sets — https://www.recraft.ai/blog/how-to-create-image-sets
- Recraft API blog (vector) — https://www.recraft.ai/blog/discover-the-power-of-recrafts-image-generation-api
- Recraft ownership/commercial FAQ — https://www.recraft.ai/blog/ownership-and-commercial-use-faq
- Recraft image upscaler — https://www.recraft.ai/image-upscaler
- findtoolz Recraft brand-aware — https://findtoolz.com/product/recraft-v3-brand-aware-ai-image-generator/
- MindStudio Recraft Studio — https://www.mindstudio.ai/blog/what-is-recraft-studio
- Replicate Recraft V3 — https://replicate.com/recraft-ai/recraft-v3
- MindStudio FLUX 1.1 Pro — https://www.mindstudio.ai/blog/what-is-flux-1-1-pro
- MindStudio FLUX Kontext Pro — https://www.mindstudio.ai/blog/what-is-flux-1-kontext-pro
- the-decoder FLUX.2 multi-reference — https://the-decoder.com/black-forest-labs-launches-flux-2-with-a-new-multi-reference-feature/
- BFL FLUX.2 model page — https://bfl.ai/models/flux-2
- BFL FLUX.2 blog — https://bfl.ai/blog/flux-2
- arxiv FLUX.1 Kontext — https://arxiv.org/html/2506.15742v2
- Tensoria Adobe Firefly commercial — https://tensoria.fr/en/tools/adobe-firefly-ai-commercial-images
- LicenseOrg Firefly indemnification — https://www.licenseorg.com/blog/adobe-firefly-indemnification-explained
- Adobe Firefly for business — https://business.adobe.com/products/firefly-business/firefly-ai-approach.html
- productgrowth Adobe Firefly review — https://productgrowth.in/tools/design/adobe-firefly/
- fal BiRefNet v2 (bg removal) — https://fal.ai/models/fal-ai/birefnet/v2
- letsenhance best upscaler APIs — https://letsenhance.io/blog/all/best-upscaler-api/
