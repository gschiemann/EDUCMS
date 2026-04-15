import { PayloadVerifier } from '../../../apps/player/app/src/main/java/com/schoolcms/security/PayloadVerifier'; // Kotlin logic mapped to Node for testing
// Note: Simulating the Kotlin logic here using our matching Node service for test simplicity
import { WebsocketSignerService } from '../../../apps/api/src/security/websocket-signer.service';

describe('Red Team: WS Replay Attack (RT-01)', () => {
  const SECRET = "test_keystore_secret";
  const signer = new WebsocketSignerService();
  (signer as any).deviceSecret = SECRET;

  it('SHOULD BLOCK: Replaying an exact intercepted payload after 10 seconds (Drift)', async () => {
    // 1. Attacker intercepts valid lockdown
    const interceptedPayload = signer.signMessage('EMERGENCY_LOCKDOWN', { severity: 'CRITICAL' });
    
    // 2. Playback is valid initially
    expect(signer.verifyMessage(interceptedPayload)).toBe(true);

    // 3. Attacker waits 11 seconds to cause a fake lockdown later
    jest.useFakeTimers();
    jest.setSystemTime(Date.now() + 11000);

    // 4. Attack fails
    const attackSuccess = signer.verifyMessage(interceptedPayload);
    expect(attackSuccess).toBe(false);
    
    jest.useRealTimers();
  });
});
