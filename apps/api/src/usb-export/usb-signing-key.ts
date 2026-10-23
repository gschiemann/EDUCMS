/**
 * The tenant's USB package signing key — minted silently the first time
 * anything needs it (2026-10-22, Greg: "get rid of all those crazy settings
 * … USB export should just work by default").
 *
 * It used to exist only after an admin turned USB on in Settings and pressed
 * "rotate key"; the export refused (403 USB_INGEST_DISABLED) until then, and
 * the player never received the key at all, so no stick ever imported. Now
 * the key is an implementation detail: the export signs with it, a paired
 * screen fetches it with its own device credential
 * (`GET /screens/:id/usb-key`), and nobody sees or manages it.
 *
 * Race-safe: two concurrent first exports write with `usbIngestKey: null` as
 * the guard, so only one key ever lands and both callers read it back.
 */
import { randomBytes } from 'crypto';

interface KeyPrisma {
  client: {
    tenant: {
      findUnique(args: any): Promise<any>;
      updateMany(args: any): Promise<any>;
    };
  };
}

export const USB_KEY_HEX = /^[0-9a-f]{64}$/i;

export async function ensureUsbSigningKey(prisma: KeyPrisma, tenantId: string): Promise<string | null> {
  const row = await prisma.client.tenant.findUnique({
    where: { id: tenantId },
    select: { usbIngestKey: true },
  });
  if (!row) return null;
  if (typeof row.usbIngestKey === 'string' && USB_KEY_HEX.test(row.usbIngestKey)) return row.usbIngestKey;
  await prisma.client.tenant.updateMany({
    where: { id: tenantId, usbIngestKey: row.usbIngestKey ?? null },
    data: { usbIngestKey: randomBytes(32).toString('hex'), usbIngestKeyRotatedAt: new Date() },
  });
  const after = await prisma.client.tenant.findUnique({
    where: { id: tenantId },
    select: { usbIngestKey: true },
  });
  return typeof after?.usbIngestKey === 'string' && USB_KEY_HEX.test(after.usbIngestKey) ? after.usbIngestKey : null;
}
