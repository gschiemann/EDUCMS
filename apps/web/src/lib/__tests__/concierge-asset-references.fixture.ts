/**
 * ConciergeReferences whose logo / photo came from different places — cut from
 * the PRODUCERS, not written by hand (2026-09-23).
 *
 * FIXTURE PROVENANCE: the VERBATIM JSON the real endpoints returned, driven on
 * the API side the way their own specs drive them:
 *   • URL_SITE_PHOTO / URL_STOCK_PHOTO — `TemplatesController.conciergeReferenceUrl`
 *     with the REAL BrandingScraperService over the committed supertacomex.com
 *     homepage and the real designer-assets gates (images: test/supertaco-site.ts
 *     behind a mocked safeFetch, bucket in memory; harness of
 *     apps/api/src/templates/concierge-reference-assets.spec.ts). For the stock
 *     one the site's hero original answers 404 and a configured Pexels source
 *     supplies the photo, so the reference carries `imageSource: 'stock'`.
 *   • UPLOAD_LOGO / UPLOAD_PHOTO / UPLOAD_DESIGN —
 *     `TemplatesController.conciergeReferenceImage` with the REAL
 *     AiAltTextService (only the provider's HTTP reply stubbed, in the OpenAI
 *     shape) and the real upload gates (harness of
 *     apps/api/src/templates/concierge-reference-image.spec.ts).
 * To regenerate: run those two harnesses with the inputs above and print the
 * returned objects. Never edit a value here by hand.
 */
import type { ConciergeReference } from '@cms/api-types';

export const URL_SITE_PHOTO = {
  "kind": "url",
  "label": "www.supertacomex.com",
  "summary": "NO MENU COULD BE READ ON THIS SITE — no item with a price was found on it or on its menu page (a menu inside an online-ordering app such as Toast, Square or DoorDash, a PDF or a photo cannot be read from a website). Brand: Super Taco. What they are / sell (use this to pick the RIGHT content — never invent a different cuisine/industry): \"Super Taco is a family chain of restaurants serving traditional style food like menudo in sacramento, tacos, enchiladas, tortas, etc. We strive to serve up the freshest ingredients and the most hospitable service since 1991.\". The brand's REAL on-site messaging — ECHO this actual voice + the services/industries it names; do NOT invent generic copy: \"Welcome To Super Taco\". Brand palette (from their logo): #f96522, #fceb00. Logo: the venue's own logo, read from their site and checked (1400×392 PNG) — place this image on the board rather than typesetting the name. Photo: one of the venue's own photos from their site, checked (1200×800) — use it where a photo fits.",
  "palette": [
    "#f96522",
    "#fceb00"
  ],
  "imageUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-st/photo-0e4d75e820f1471b.jpg",
  "logoUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-st/logo-a85c0b18b11f1697.png",
  "imageSource": "site",
  "logoSource": "site"
} as unknown as ConciergeReference;

export const URL_STOCK_PHOTO = {
  "kind": "url",
  "label": "www.supertacomex.com",
  "summary": "NO MENU COULD BE READ ON THIS SITE — no item with a price was found on it or on its menu page (a menu inside an online-ordering app such as Toast, Square or DoorDash, a PDF or a photo cannot be read from a website). Brand: Super Taco. What they are / sell (use this to pick the RIGHT content — never invent a different cuisine/industry): \"Super Taco is a family chain of restaurants serving traditional style food like menudo in sacramento, tacos, enchiladas, tortas, etc. We strive to serve up the freshest ingredients and the most hospitable service since 1991.\". The brand's REAL on-site messaging — ECHO this actual voice + the services/industries it names; do NOT invent generic copy: \"Welcome To Super Taco\". Brand palette (from their logo): #f96522, #fceb00. Logo: the venue's own logo, read from their site and checked (1400×392 PNG) — place this image on the board rather than typesetting the name. Photo: the site had no usable photo, so this is a STOCK photo (\"mexican food tacos\") — not the venue's own; never caption it as theirs.",
  "palette": [
    "#f96522",
    "#fceb00"
  ],
  "imageUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-st/photo-dc7e1993bf79c199.jpg",
  "logoUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-st/logo-a85c0b18b11f1697.png",
  "imageSource": "stock",
  "logoSource": "site"
} as unknown as ConciergeReference;

export const UPLOAD_LOGO = {
  "kind": "image",
  "summary": "A bold orange and yellow wordmark with a sun mark. Logo: this upload is the venue's own logo, uploaded by the operator and checked (1400×392 PNG) — place this image on the board rather than typesetting the name.",
  "label": "super-taco-logo.png",
  "logoUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-img/uploads/a85c0b18b11f1697.png",
  "logoSource": "upload",
  "palette": [
    "#f96522",
    "#fceb00"
  ]
} as unknown as ConciergeReference;

export const UPLOAD_PHOTO = {
  "kind": "image",
  "summary": "A warm close-up of birria tacos on a red tray. Photo: this upload is one of the venue's own photos, uploaded by the operator and checked (1600×1067) — use it where a photo fits.",
  "label": "birria-tacos.jpg",
  "imageUrl": "https://sb.example/storage/v1/object/public/assets/ai-designer/tenant-img/uploads/d6baa871721482fc.jpg",
  "imageSource": "upload",
  "palette": [
    "#8a2b0e",
    "#f2c14e"
  ]
} as unknown as ConciergeReference;

export const UPLOAD_DESIGN = {
  "kind": "image",
  "summary": "A neon bar sign on dark brick — moody, high contrast. This image is inspiration for the look — not an asset to place on the board.",
  "label": "neon-inspo.jpg",
  "palette": [
    "#ff2bd6",
    "#111111"
  ]
} as unknown as ConciergeReference;
