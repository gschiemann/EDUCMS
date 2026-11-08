/**
 * CLEAR THE UPDATE QUARANTINE ON ONE SCREEN (Manager wave 3, #8).
 *
 * The companion Manager sets a build aside (`QuarantineList`) when it failed
 * its first boot, and it never expires. This is the operator's way to let that
 * build be offered again on ONE screen: a signed `CLEAR_UPDATE_QUARANTINE`
 * message that only the targeted screen acts on; the web player relays it to
 * the APK, which tells the Manager.
 *
 * What it is NOT, said plainly because the dashboard repeats it:
 *  - it is not a rollback. VenueOS is never the device owner, and without
 *    device owner Android refuses to install an older versionCode over a
 *    release-signed package, so a build already on the screen can only go
 *    forward;
 *  - it is not acknowledged. The command is delivered while the screen is
 *    online and an APK new enough to carry the relay (>= 1.1.66) is running;
 *    "sent" is all the server can honestly say.
 *
 * Pure of Nest: the controller does the auth, tenancy and audit; this builds
 * the message and the audit vocabulary.
 */
import type { RedisService } from '../realtime/redis.service';
import type { WebsocketSignerService } from '../security/websocket-signer.service';
import type { CommandScreen } from './screen-commands';

export const CLEAR_UPDATE_QUARANTINE_AUDIT_ACTION = 'UPDATE_QUARANTINE_CLEARED';

export const QUARANTINE_NO_ROLLBACK_NOTE =
  'This lets the screen be offered the build again. It does not roll anything back: without device owner, Android will not install an older version over the one already running.';

export async function publishClearUpdateQuarantine(
  deps: {
    signer: Pick<WebsocketSignerService, 'signMessage'>;
    redis: Pick<RedisService, 'publish'>;
  },
  screen: CommandScreen,
  opts: { requestedBy: string | null; corrId: string },
): Promise<boolean> {
  const signed = deps.signer.signMessage('CLEAR_UPDATE_QUARANTINE', {
    scope: 'screen',
    scopeId: screen.id,
    tenantId: screen.tenantId,
    requestedBy: opts.requestedBy,
    corrId: opts.corrId,
  });
  try {
    await deps.redis.publish(`tenant:${screen.tenantId}`, signed);
    return true;
  } catch (e) {
    console.warn(`[clear-quarantine ${opts.corrId}] redis publish failed for ${screen.id}:`, (e as Error).message);
    return false;
  }
}
