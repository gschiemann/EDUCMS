"use client";

/**
 * /[schoolId]/settings/people/sso — the canonical SSO route (§8).
 *
 * The old `/[schoolId]/settings/sso` URL still resolves: it re-exports this
 * same component, so bookmarks and support links keep working.
 */
import { SsoSettingsEditor } from '@/components/settings/people/SsoSettingsEditor';

export default function PeopleSsoSettingsPage() {
  return <SsoSettingsEditor />;
}
