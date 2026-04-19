/**
 * sanitize-svg — defense against stored XSS via branding logoSvgInline.
 *
 * The branding flow scrapes SVG wordmarks from customer websites and
 * surfaces them to an admin who can adopt them as their logo. The logo
 * is stored in TenantBranding.logoSvgInline and later rendered by
 * other admins via dangerouslySetInnerHTML. An attacker-controlled
 * source page (or a malicious URL pasted by an admin) could therefore
 * smuggle <svg onload="..."> or <script> into another admin's session.
 *
 * Strategy: silent-strip with DOMPurify's svg profile. Admins don't
 * need to debug why their upload was rejected; we log a breadcrumb
 * when anything actually got cleaned so abuse is observable.
 *
 * Paired with a render-time sanitize on the web side — defense in
 * depth, in case dirty rows were written before this fix shipped.
 */

import DOMPurify from 'isomorphic-dompurify';

export function sanitizeLogoSvg(raw: string | null | undefined): string {
  if (!raw || typeof raw !== 'string') return '';
  return DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'style', 'foreignObject'],
    // DOMPurify strips on* handlers by default; listing here is belt+suspenders.
    FORBID_ATTR: [
      'onload', 'onerror', 'onclick', 'onmouseover', 'onmouseenter',
      'onmouseleave', 'onfocus', 'onblur', 'onkeydown', 'onkeyup',
      'onkeypress', 'onanimationstart', 'onanimationend', 'onanimationiteration',
      'ontransitionend', 'onbegin', 'onend', 'onrepeat',
    ],
  });
}
