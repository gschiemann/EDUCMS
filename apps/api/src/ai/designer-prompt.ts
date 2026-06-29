/**
 * designer-prompt.ts — the "AI Designer" brain (2026-06-28).
 *
 * Greg's mandate: AI template generation must produce DESIGNER-LEVEL boards —
 * authored by a top model as a COMPLETE HTML document — that match or beat
 * Canva / Adobe-Express-class tools. The art-director-engine path templates a
 * fixed layout (the "MS Paint" look); this path lets the model DESIGN the whole
 * board, which is the only way to reach the quality bar (and where a higher-end
 * model actually pays off).
 *
 * Pure functions only (prompt builder + HTML sanitizer + Taurus audit) so they
 * unit-test without the Nest container. The rendered HTML drops into an
 * EXTERNAL_HTML zone's `config.html` and renders through the existing null-origin
 * sandboxed iframe (ExternalHtmlWidget srcdoc path). See
 * docs/research/2026-06-28-ai-designer-html/00-DESIGN.md.
 */

/**
 * Font families the web renderer actually loads (SIGNAGE_FONTS_HREF in
 * WidgetRenderer.tsx). The AI MUST pick display+body ONLY from this list — a
 * family the renderer doesn't load silently falls back to system-ui (the exact
 * "looks unstyled" failure). Kept in sync with that href.
 */
export const DESIGNER_FONTS = [
  'Inter', 'Oswald', 'Poppins', 'Montserrat', 'Cormorant Garamond', 'Barlow',
  'Playfair Display', 'Sora', 'Space Grotesk', 'Fraunces', 'Anton', 'Archivo',
  'Fredoka', 'Source Serif 4', 'Nunito Sans', 'Mulish', 'Barlow Condensed',
] as const;

export interface DesignerBoardOptions {
  /** Operator's brief / what the board is for. */
  prompt: string;
  /** Canvas in px (e.g. 1920×1080 landscape, 1080×1920 portrait, LED sizes). */
  width: number;
  height: number;
  /** Vertical (bar, qsr, retail, gym, …) — drives voice + imagery. */
  vertical?: string;
  /** The venue's brand palette (hex). First is treated as primary. */
  palette?: string[];
  /** Venue name + tagline + logo, when known. */
  venueName?: string;
  tagline?: string;
  logoUrl?: string;
  /** Real content the board must show (menu items+prices, headline, hours…). */
  content?: string;
  /** Reference summary (scraped site / uploaded image) to match the look. */
  reference?: string;
  /**
   * Per-candidate ART DIRECTION so a 3-up fan-out yields DISTINCT designs, not
   * three clones. e.g. "bold editorial, full-bleed photo" vs "clean minimal,
   * generous whitespace" vs "vibrant, color-blocked".
   */
  artDirection?: string;
}

const FONT_LIST = DESIGNER_FONTS.join(', ');

/**
 * A worked, Taurus-safe exemplar baked into the system prompt as a few-shot
 * anchor. It demonstrates the craft level + the exact technical contract (fixed
 * stage + self-scale script, fonts <link>, photo panel WITH a scrim so content
 * stays the hero, eyebrow, characterful display wordmark, dotted-leader menu
 * rows with tabular prices, footer, data-field/data-imgslot hooks, NO
 * inset/gap). The model is told to MATCH THE QUALITY for the real brief — never
 * to copy it verbatim. Keep this Chromium-83-clean (auditDesignerHtmlTaurus must
 * return [] for it — there is a unit test).
 */
export const DESIGNER_EXEMPLAR = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8">',
  '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">',
  '<style>',
  '*{margin:0;padding:0;box-sizing:border-box}',
  'html,body{width:100%;height:100%;background:#15181c;overflow:hidden}',
  '#fit{position:absolute;top:0;left:0;transform-origin:top left}',
  '.stage{position:relative;width:1920px;height:1080px;background:linear-gradient(135deg,#262c34 0%,#15181c 72%);color:#f0f1f3;font-family:Inter,sans-serif;overflow:hidden}',
  '.photo{position:absolute;top:0;right:0;bottom:0;width:600px;background:#23282f}',
  '.photo img{width:100%;height:100%;object-fit:cover;filter:grayscale(.28) contrast(1.05) brightness(.9)}',
  '.photo:after{content:"";position:absolute;top:0;left:0;bottom:0;width:260px;background:linear-gradient(90deg,#262c34,rgba(38,44,52,0))}',
  '.foot{position:absolute;left:120px;right:660px;bottom:54px;height:40px;display:flex;align-items:center;font-size:25px;color:#c1c8d1;letter-spacing:.03em}',
  '.foot b{color:#f0f1f3;font-weight:700}',
  '.fit{position:absolute;top:90px;left:120px;width:1080px;transform-origin:top left}',
  '.eyebrow{font-weight:700;letter-spacing:.34em;text-transform:uppercase;font-size:25px;color:#f0523d;margin-bottom:16px;display:flex;align-items:center}',
  '.eyebrow i{width:14px;height:14px;border-radius:50%;background:#f0523d;margin-right:14px;font-style:normal}',
  '.wordmark{font-family:Fraunces,serif;font-weight:800;font-size:118px;line-height:.9;letter-spacing:-.015em}',
  '.wordmark span{color:#f0523d}',
  '.tag{font-family:Fraunces,serif;font-style:italic;font-weight:500;font-size:34px;color:#c1c8d1;margin-top:12px;margin-bottom:42px}',
  '.rule{width:110px;height:4px;background:#f0523d;margin-bottom:38px}',
  '.row{display:flex;align-items:baseline;margin-bottom:26px}',
  '.nm{font-family:Fraunces,serif;font-weight:600;font-size:46px;white-space:nowrap}',
  '.sub{display:block;font-family:Inter;font-weight:400;font-size:22px;color:#9aa3ad;margin-top:3px;white-space:nowrap}',
  '.dots{flex:1;border-bottom:2px dotted #4a5464;margin:0 20px 12px}',
  '.pr{font-weight:700;font-size:44px;color:#f0523d;font-variant-numeric:tabular-nums}',
  '</style></head><body><div id="fit"><div class="stage">',
  '<div class="photo"><img data-imgslot="hero" src="https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80&auto=format&fit=crop" onerror="this.style.display=\'none\'" alt=""></div>',
  '<div class="fit" id="cc">',
  '<div class="eyebrow" data-field="eyebrow"><i></i>Brentwood · Est. 2019</div>',
  '<div class="wordmark" data-field="venue">Chrome<span>.</span></div>',
  '<div class="tag" data-field="tagline">Single-origin espresso &amp; slow mornings</div>',
  '<div class="rule"></div>',
  '<div class="row"><div class="nm" data-field="item.0.name">Cortado<span class="sub" data-field="item.0.desc">double ristretto · steamed milk</span></div><div class="dots"></div><div class="pr" data-field="item.0.price">$4.50</div></div>',
  '<div class="row"><div class="nm" data-field="item.1.name">Flat White<span class="sub" data-field="item.1.desc">silky microfoam</span></div><div class="dots"></div><div class="pr" data-field="item.1.price">$5.00</div></div>',
  '<div class="row"><div class="nm" data-field="item.2.name">Pour Over<span class="sub" data-field="item.2.desc">rotating single origin · V60</span></div><div class="dots"></div><div class="pr" data-field="item.2.price">$5.00</div></div>',
  '<div class="row"><div class="nm" data-field="item.3.name">Brown Sugar Oat Latte<span class="sub" data-field="item.3.desc">house syrup · oat milk</span></div><div class="dots"></div><div class="pr" data-field="item.3.price">$5.75</div></div>',
  '<div class="row"><div class="nm" data-field="item.4.name">Nitro Cold Brew<span class="sub" data-field="item.4.desc">18-hour steep · on tap</span></div><div class="dots"></div><div class="pr" data-field="item.4.price">$5.25</div></div>',
  '</div>',
  '<div class="foot"><b data-field="hours">Open 6a–4p daily</b>&nbsp;·&nbsp;11700 San Vicente Blvd</div>',
  '</div></div>',
  '<script>(function(){var W=1920,H=1080,FOOT=150,fit=document.getElementById("fit"),col=document.getElementById("cc");',
  'function fitCol(){if(!col)return;col.style.transform="none";var avail=H-90-FOOT,h=col.offsetHeight;if(h>avail)col.style.transform="scale("+(avail/h)+")";}',
  'function fitStage(){var k=Math.min(window.innerWidth/W,window.innerHeight/H);fit.style.transform="scale("+k+")";fit.style.left=((window.innerWidth-W*k)/2)+"px";fit.style.top=((window.innerHeight-H*k)/2)+"px";}',
  'fitCol();fitStage();window.addEventListener("resize",fitStage);if(document.fonts&&document.fonts.ready){document.fonts.ready.then(fitCol);}setTimeout(fitCol,900);})();</script>',
  '</body></html>',
].join('');

/**
 * The system prompt — a world-class signage designer. This is the IP; tune it
 * against live screenshots until 3-of-3 generations come back designer-level.
 */
export const DESIGNER_SYSTEM_PROMPT = [
  'You are a world-class graphic + signage designer (think Pentagram / Aesop / Kinfolk / a great cafe chalk-artist) building ONE digital-signage board as a COMPLETE, self-contained HTML document. Your work hangs on a wall and must look like a human designer labored over it for days — NOT like a template or a slide.',
  '',
  'OUTPUT CONTRACT — return ONLY the raw HTML document. Start with <!doctype html>. NO markdown fences, NO commentary, NO explanation before or after. One document, fully self-contained (inline <style>; one <link> to Google Fonts for the families you use; inline <script> only if needed for self-scaling).',
  '',
  'THE QUALITY BAR (non-negotiable — this is the whole point):',
  '- Real composition: a clear focal point, deliberate hierarchy, an underlying grid, generous + intentional whitespace. NEVER plain centered text on a flat colored box (that is the failure we are replacing).',
  '- Real typography: pair a CHARACTERFUL display face with a clean body face; dramatic size contrast; tight display tracking; large enough to read across a room.',
  '- Real detail: dividers / hairline rules, an eyebrow/kicker, dotted leader lines on menus, section labels, a small accent tick or rule, layered depth (a duotone photo, a subtle texture/gradient, a color-blocked panel). Borrow the craft of a printed poster or a designed menu.',
  '- Real imagery where it fits: a relevant photograph CONFINED to a side panel, a top/bottom band, or a column — NOT a full-bleed wash behind dense text (that kills legibility). If you ever place a photo behind text, it must carry a strong palette scrim/duotone AND the text must sit on the solid-color part, never over the busy part of the photo. Use Unsplash source URLs (https://images.unsplash.com/photo-...?w=1600&q=80&auto=format&fit=crop) chosen for the venue/topic. ALWAYS put a CSS gradient (in the venue palette) BEHIND every image so a failed load is still on-brand, never blank. Add onerror="this.style.display=\'none\'" to <img>.',
  '',
  'CONTENT IS THE HERO (the #1 failure to avoid): the board exists to communicate its CONTENT — the menu, the offer, the headline, the schedule. That content must be the largest, sharpest, most prominent thing on the board and fully legible across a room. Photography SUPPORTS the content — confine it to a panel/strip OR, if full-bleed, lay a strong palette scrim/duotone over it so EVERY character stays crisp. NEVER let a photo or background wash dominate and shrink the content to an afterthought. If you must choose, the content wins.',
  '',
  'BRAND — match the venue, do not invent a generic look:',
  '- Use the supplied palette as the backbone (primary, accents, ink, surface). If none, derive a tasteful on-vertical palette.',
  '- Use the venue NAME, tagline, logo, and the REAL content provided (actual menu items + prices, the real headline, real hours). NEVER lorem/placeholder text. If content is thin, write tight on-brand copy in the venue voice.',
  '- Reflect any reference (scraped site / uploaded image) — its palette, mood, era, formality.',
  '',
  `TYPOGRAPHY — use ONLY these loaded fonts (any other silently falls back to a system font): ${FONT_LIST}. Load exactly the families you use via one <link href="https://fonts.googleapis.com/css2?...&display=swap">.`,
  '',
  'EDITABILITY — every text element a human might change gets data-field="<shortKey>" (e.g. data-field="headline", data-field="item.0.name", data-field="item.0.price"); every photo gets data-imgslot="<key>". Keep keys short + stable. (A later layer reads these for click-to-edit; the board must still render perfectly with none of them touched.)',
  '',
  'TECH + HARD CONSTRAINTS — the board ships to locked-down LED controllers (Chromium 83) and a sandboxed iframe:',
  '- The board is EXACTLY the given pixel size. Wrap everything in a fixed-size stage div at that exact width/height, then scale it to fit the viewport with transform:scale + a tiny inline script (measure the iframe, scale = min(vw/W, vh/H), transform-origin top-left, center it). This is the only inline JS you need.',
  '- Chromium-83 SAFE CSS ONLY: NEVER use the `inset` shorthand (use top/right/bottom/left longhand). NEVER use `gap` on flex/grid (use margins). NO :has(), NO container queries, NO CSS nesting, NO color-mix()/oklch(). Prefer flexbox + absolute positioning. backdrop-filter is unreliable — avoid or provide a solid fallback.',
  '- NO external <script src> (no remote code). NO <iframe>/<object>/<embed>. Inline <style> + the one self-scaling <script> + the fonts <link> + <img> from https only.',
  '',
  'LAYOUT CONTRACT — the #2 failure to avoid is content overflowing or COLLIDING with the footer. Obey this exactly:',
  '- Think in BANDS: a header band (top), a content band (middle), and a RESERVED footer band (bottom, ~110-160px). The footer (hours/address/CTA) lives ONLY in its own pinned band; NOTHING else may enter it. Pin the footer with position:absolute; bottom:Npx and keep the content column ABOVE it.',
  '- COUNT the items you were given and make ALL of them fit with breathing room. Choose row height / font size for the actual count. If there are more rows than fit one column comfortably (roughly 7+ on landscape), use TWO columns — never shrink to illegible or clip the last rows.',
  '- REQUIRED auto-fit safety net: give the content column an id and, in your inline script (in addition to the stage self-scale), measure it and if it is taller than the space above the footer band, apply transform:scale(avail/height) with transform-origin top-left. Re-run it on document.fonts.ready and via a setTimeout — web fonts load late and change the height. This GUARANTEES nothing overflows or collides even if your size estimate is off. (See the exemplar script: fitCol + fitStage.)',
  '- Final self-check before output: every provided item present, nothing clipped at any edge, the footer not touching any row, all text legible at a glance.',
  '',
  'STUDY THIS EXEMPLAR for the craft level + the exact technical contract (fixed stage; the fitStage + fitCol scripts; a photo CONFINED to a side panel with a scrim so the content stays the hero; a reserved footer band the content never enters; eyebrow, characterful wordmark, dotted-leader rows, tabular prices; data-field/data-imgslot hooks; NO inset/gap). MATCH THIS QUALITY for the real brief — adapt the layout, palette, type, and content to the actual venue; do NOT copy it verbatim or reuse its coffee content:',
  DESIGNER_EXEMPLAR,
  '',
  'Deliver the single best board you can — gallery-grade, on-brand, complete. Return ONLY the HTML.',
].join('\n');

/** Build the user-turn message for one board generation. */
export function buildDesignerUserPrompt(opts: DesignerBoardOptions): string {
  const orient = opts.height > opts.width ? 'portrait' : 'landscape';
  const lines: string[] = [
    `Brief: ${opts.prompt}`,
    `Canvas: ${opts.width} × ${opts.height} px (${orient}).`,
    `Vertical: ${opts.vertical || 'venue'}.`,
  ];
  if (opts.venueName) lines.push(`Venue name: ${opts.venueName}.`);
  if (opts.tagline) lines.push(`Tagline: ${opts.tagline}.`);
  if (opts.palette && opts.palette.length) lines.push(`Brand palette (hex, first = primary): ${opts.palette.join(', ')}.`);
  if (opts.logoUrl) lines.push(`Logo URL (use it, e.g. top-left): ${opts.logoUrl}`);
  if (opts.content) lines.push('', 'REAL CONTENT to feature (use verbatim — items, prices, copy):', opts.content);
  if (opts.reference) lines.push('', `Reference (match this look/brand): ${opts.reference}`);
  if (opts.artDirection) lines.push('', `ART DIRECTION for THIS board (make it distinct): ${opts.artDirection}`);
  lines.push('', 'Return ONLY the complete HTML document.');
  return lines.join('\n');
}

/** Three distinct art directions so a 3-candidate fan-out yields different designs. */
export const DESIGNER_ART_DIRECTIONS: string[] = [
  'Bold editorial — a strong hero photograph CONFINED to one side panel or a top band (NOT a full-bleed wash behind the text) next to a confident oversized headline; magazine-cover energy, but the content stays crisp on a solid-color field.',
  'Clean & premium — minimal, lots of intentional whitespace, a refined type pairing and a single restrained accent; Aesop/Apple calm. Photo optional + subtle (small inset or none).',
  'Vibrant & graphic — color-blocked panels or a rich on-palette gradient, oversized type, a lively accent; high-impact and scroll-stopping while staying on-brand. Photo optional; if used, keep it in its own block.',
];

/** Result of sanitizing AI-authored board HTML. */
export interface SanitizedDesignerHtml {
  html: string;
  /** Non-fatal Chromium-83 (Taurus) issues found — for logging + prompt tuning. */
  taurusWarnings: string[];
}

/**
 * Sanitize AI-authored board HTML for the sandboxed-iframe render. The iframe is
 * null-origin (sandbox="allow-scripts", NO allow-same-origin) so the document
 * can't reach the parent, cookies, or storage — that's the primary containment.
 * Here we additionally strip remote-code + nested-framing vectors and validate
 * the doc is real. Throws on unusable input. Inline <script> is KEPT (the board's
 * own self-scaling JS; contained by the sandbox), matching the existing
 * EXTERNAL_HTML trust model.
 */
export function sanitizeDesignerHtml(raw: unknown): SanitizedDesignerHtml {
  if (typeof raw !== 'string') throw new Error('Designer HTML must be a string.');
  let html = raw.trim();
  // Strip accidental markdown fences the model sometimes wraps around the doc.
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // If the model prepended prose, cut to the first doctype/<html>/<!-- so we keep
  // only the document.
  const docStart = html.search(/<!doctype html|<html[\s>]/i);
  if (docStart > 0) html = html.slice(docStart);
  if (html.length < 200 || !/<(body|main|div|section|html)[\s>]/i.test(html)) {
    throw new Error('Designer HTML is not a usable document.');
  }
  // SECURITY: drop remote-code + nested-framing vectors. Inline scripts stay
  // (sandbox-contained; needed for self-scaling).
  html = html
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*>\s*<\/script>/gi, '') // external scripts
    .replace(/<script\b[^>]*\bsrc\s*=[^>]*\/?>/gi, '')
    .replace(/<(iframe|object|embed)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|object|embed)\b[^>]*\/?>/gi, '');
  return { html, taurusWarnings: auditDesignerHtmlTaurus(html) };
}

/**
 * Flag Chromium-83-unsafe CSS (NovaStar Taurus floor). Non-fatal — returned for
 * logging + prompt tuning; the prompt forbids these, and a live Taurus check is
 * the backstop. (We don't auto-rewrite — that's brittle on free-form CSS.)
 */
export function auditDesignerHtmlTaurus(html: string): string[] {
  const warns: string[] = [];
  if (/\binset\s*:/.test(html)) warns.push('uses `inset:` shorthand (Chromium 83 drops it — use top/right/bottom/left)');
  if (/[;{]\s*gap\s*:/.test(html)) warns.push('uses `gap:` on a flex/grid container (Chromium 84+ — use margins)');
  if (/:has\(/.test(html)) warns.push('uses :has() (not in Chromium 83)');
  if (/@container\b/.test(html)) warns.push('uses container queries (not in Chromium 83)');
  if (/\bcolor-mix\(|\boklch\(/.test(html)) warns.push('uses color-mix()/oklch() (not in Chromium 83)');
  return warns;
}
