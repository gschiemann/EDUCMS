/**
 * The folder name a USB export writes its package into.
 *
 * 2026-11-08 VenueOS rebrand. Players 1.1.55–1.1.65 find a USB package by
 * the `edu-cms-content…` folder name (or a manifest.json + manifest.sig pair
 * side by side); the new reader accepts `venueos-content…` too. So the writer
 * keeps the old name until the fleet runs the new reader, and the lead flips
 * it with one env var:
 *
 *   USB_EXPORT_FOLDER_NAME unset / anything else → `edu-cms-content` (today)
 *   USB_EXPORT_FOLDER_NAME=venueos              → `venueos-content`
 *
 * Failure direction: an unrecognised value writes the LEGACY name, the one
 * every player build reads. Kill switch: unset it. The manifest `schema`
 * (`edu-cms-usb-bundle/v1`) is an internal format id under the HMAC and does
 * not change with this switch. Declared in docs/ENVIRONMENT.md.
 */
export const LEGACY_USB_EXPORT_FOLDER = 'edu-cms-content';
export const VENUEOS_USB_EXPORT_FOLDER = 'venueos-content';

export function usbExportFolderName(env: NodeJS.ProcessEnv = process.env): string {
  const v = (env.USB_EXPORT_FOLDER_NAME || '').trim().toLowerCase();
  return v === 'venueos' ? VENUEOS_USB_EXPORT_FOLDER : LEGACY_USB_EXPORT_FOLDER;
}
