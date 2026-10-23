'use client';

/**
 * /[schoolId]/settings/player/offline (and the preserved /settings/usb) —
 * there are no USB settings any more (2026-10-22, Greg: "get rid of all those
 * crazy settings in the admin portal on creating keys … just allow people to
 * download the playlist to a USB by default").
 *
 * What used to live here — the on/off switch, the signing-key rotation with
 * its show-once secret, the bundle builder with a target-screen picker — is
 * gone: the API signs every package with a key it mints itself, a paired
 * screen fetches that key with its own credential, and "Download to USB" sits
 * on every playlist. Old bookmarks and support links land on Playlists.
 */

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function UsbSettingsMovedPage() {
  const params = useParams<{ schoolId: string }>();
  const router = useRouter();
  const t = useTranslations('usbDelivery');
  const schoolId = params?.schoolId || '';
  useEffect(() => {
    if (schoolId) router.replace(`/${schoolId}/playlists`);
  }, [router, schoolId]);
  return (
    <p role="status" className="p-6 text-sm text-slate-600">
      {t('settingsMoved')}
    </p>
  );
}
