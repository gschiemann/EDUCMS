"use client";

/**
 * /[schoolId]/settings/sso — PRESERVED OLD URL (§8, §23 "do not remove old
 * routes before redirects and support references are in place").
 *
 * The SSO editor now lives under People & access at
 * `/[schoolId]/settings/people/sso`. This route stays as a thin re-export of
 * the same component so existing bookmarks, IdP setup docs and support links
 * keep resolving. The settings registry lists `sso` in the People section's
 * `matches`, so the index highlights People & access either way.
 */
import { SsoSettingsEditor } from '@/components/settings/people/SsoSettingsEditor';

export default function SsoSettingsPage() {
  return <SsoSettingsEditor />;
}
