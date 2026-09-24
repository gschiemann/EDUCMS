"use client";

/**
 * /[schoolId]/settings/security — "My security" (handoff §7.11).
 *
 * Account-scoped and available to EVERY authenticated role: a CONTRIBUTOR
 * secures their own login exactly like an admin does. The `schoolId` route
 * param is a compatibility artefact — nothing on this page is tenant-scoped,
 * so the shell's scope control reads "Personal account" (§9.1) rather than
 * the organization the operator happens to be viewing.
 *
 * Only two things are actually implemented for a personal account today —
 * password rotation (which also revokes every other live token) and TOTP
 * enrollment/recovery. There is no per-session device list behind
 * `apps/api/src/auth`, so this page does NOT pretend to offer one: the
 * containment behaviour that IS built is stated where it happens, next to
 * the password form (§7.11 "…ONLY if implemented").
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { MfaCard } from '@/components/settings/MfaCard';
import { PasskeyCard } from '@/components/settings/PasskeyCard';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { SettingsPageFrame } from '@/components/settings/shell/SettingsPageFrame';
import {
  ContextModule,
  EditorHead,
  EditorSection,
  StatusPill,
} from '@/components/settings/shell/primitives';
import { useMfaStatus } from '@/hooks/use-api';

export default function SecuritySettingsPage() {
  const t = useTranslations();
  // read-only GET; `retry:false`, so an error simply leaves us at "unknown"
  // rather than asserting a two-factor state we cannot prove.
  const { data: mfaStatus, isLoading: mfaLoading, isError: mfaError } = useMfaStatus();
  const mfaState: 'on' | 'off' | 'unknown' =
    mfaLoading || mfaError || !mfaStatus ? 'unknown' : mfaStatus.enabled ? 'on' : 'off';

  // `?add=passkey` (2026-09-24) — the account menu's "Set up a passkey" lands
  // here with the Add panel already open and the Passkeys section scrolled
  // into view; `#sec-passkeys` ("Manage passkeys") only scrolls. Read after
  // mount, so the page needs no useSearchParams Suspense boundary (the same
  // pattern billing uses for `?checkout=`).
  const [addPasskeyRequested, setAddPasskeyRequested] = useState(false);
  useEffect(() => {
    let wantsPasskeys = false;
    try {
      if (new URLSearchParams(window.location.search).get('add') === 'passkey') {
        setAddPasskeyRequested(true);
        wantsPasskeys = true;
      }
      if (window.location.hash === '#sec-passkeys') wantsPasskeys = true;
    } catch { /* nothing to read */ }
    // The sections are static, so the target exists on the first paint.
    if (wantsPasskeys) document.getElementById('sec-passkeys')?.scrollIntoView?.({ block: 'start' });
  }, []);

  const searchItems = useMemo(
    () => [
      { label: t('settings.cc.security.searchPassword'), anchor: 'sec-password', keywords: ['password', 'rotate', 'sign out'] },
      { label: t('settings.cc.security.searchPasskeys'), anchor: 'sec-passkeys', keywords: ['passkey', 'webauthn', 'face id', 'touch id', 'windows hello', 'security key', 'fingerprint'] },
      { label: t('settings.cc.security.searchMfa'), anchor: 'sec-mfa', keywords: ['2fa', 'mfa', 'totp', 'authenticator', 'recovery codes'] },
    ],
    [t],
  );

  const context = (
    <>
      <ContextModule
        label={t('settings.cc.security.railMfaLabel')}
        title={
          <StatusPill
            kind={mfaState === 'on' ? 'ready' : mfaState === 'off' ? 'notConfigured' : 'unknown'}
            label={
              mfaState === 'on'
                ? t('settings.cc.security.railMfaOn')
                : mfaState === 'off'
                  ? t('settings.cc.security.railMfaOff')
                  : t('settings.cc.security.railMfaUnknown')
            }
          />
        }
      >
        {mfaState === 'on'
          ? t('settings.cc.security.railMfaOnBody')
          : mfaState === 'off'
            ? t('settings.cc.security.railMfaOffBody')
            : t('settings.cc.security.railMfaUnknownBody')}
      </ContextModule>
      <ContextModule
        label={t('settings.cc.security.railScopeLabel')}
        title={t('settings.cc.security.railScopeTitle')}
      >
        {t('settings.cc.security.railScopeBody')}
      </ContextModule>
    </>
  );

  return (
    <SettingsPageFrame
      section="security"
      title={t('settings.shell.sections.security.label')}
      description={t('settings.shell.sections.security.description')}
      // Explicitly personal — this section ignores the tenant scope (§9.1).
      scope={{ kind: 'account', label: t('settings.shell.scopePersonal') }}
      searchItems={searchItems}
      context={context}
    >
      <EditorHead
        icon={Lock}
        title={t('settings.cc.security.editorTitle')}
        description={t('settings.cc.security.editorDesc')}
      />

      <EditorSection
        id="sec-password"
        title={t('settings.cc.security.passwordTitle')}
        description={t('settings.cc.security.passwordDesc')}
      >
        <ChangePasswordCard />
        <p className="mt-3 text-[12px] leading-[17px] text-slate-500">
          {t('settings.cc.security.sessionsNote')}
        </p>
      </EditorSection>

      {/* Passkeys sit ABOVE two-factor on purpose (2026-09-21). The operator
          asked for this because the authenticator app is the part they hate;
          the answer to that sentence should be the first thing they see, with
          the app underneath as the fallback factor it now is. */}
      <EditorSection
        id="sec-passkeys"
        title={t('settings.cc.security.passkeysTitle')}
        description={t('settings.cc.security.passkeysDesc')}
      >
        <PasskeyCard autoOpenAdd={addPasskeyRequested} />
      </EditorSection>

      <EditorSection
        id="sec-mfa"
        title={t('settings.cc.security.mfaTitle')}
        description={t('settings.cc.security.mfaDesc')}
      >
        <MfaCard />
      </EditorSection>
    </SettingsPageFrame>
  );
}
