# End-to-End Test Scenarios

## 1. Auth & Publish Flow Tests
### Happy Path: Standard Asset Publish
1. **Action**: School Admin legitimately authenticates to platform.
2. **Action**: Navigates to Media Library -> Initiates upload mapping for `lunch_menu.jpg`.
3. **Verify**: System successfully verifies file magic properties, passes ClamAV virus scan (Asset Sanitization) -> Returns `201 Created`.
4. **Action**: Admin appends asset to "Daily Announcements" playlist string and initiates "Publish".
5. **Verify**: Player sync mechanism operates; target devices receive realtime WebSocket `PLAYLIST_UPDATED` event, download the asset URL cache, and adjust display.

### Failure Path: Contributor Unauthorized Publish
1. **Action**: Contributor authenticates and successfully uploads base image.
2. **Action**: Contributor intentionally crafts a malicious HTTP POST to direct `/api/playlists/publish` targeting the live screen group.
3. **Verify**: System immediately replies with `403 Forbidden`.
4. **Verify**: Audit log securely registers unauthorized `AUTHORIZATION_FAILURE` from actor profile.

## 2. Device Provisioning Tests
### Happy Path: Kiosk Registration
1. **Action**: Technician boots unprovisioned Android TV box.
2. **Action**: Reads raw 6-digit Secure Pairing Code off-screen, logs into Admin portal and inputs code.
3. **Verify**: Backend strictly validates pairing code window, issues cryptographically unique JWT device keys, and pairs hardware to specific tenant database.
4. **Action**: Hardware receives JWT configuration parameter and begins immediate playlist sync.

### Failure Path: Expired Registration Code
1. **Action**: Technician attempts to provision using a Pairing Code generated exactly 16 minutes prior.
2. **Verify**: Admin frontend rejects pairing as `"Code Expired"`.
3. **Verify**: Digital signage player strictly remains stuck on pairing configuration overlay, refusing backend comms.

## 3. Revoked-Device Behavior Tests
### Target Assertion: Ghost-Protection
1. **Action**: Security Administrator clicks 'Revoke Device' spanning an active TV instance from dashboard context.
2. **Verify**: System securely invalidates database active token and concurrently commands the Gateway API to force-disconnect the device's WebSocket.
3. **Action**: Revoked device aggressively attempts HTTP long-pull auto-reconnect fallback.
4. **Verify**: Backend blocks HTTP polling with strict `401 Unauthorized` headers.
5. **Verify**: Local Android script senses `401`, systematically purges localized disk cache (sqlite media), and hard-resets device back to empty unprovisioned pairing screen format.

## 4. Asset Upload & Sanitization Tests
### Failure Path: Malicious Execution Payload
1. **Action**: Attacker/Tester attempts to post `malware_script.exe` artificially renamed as `cute_dog.jpg`.
2. **Verify**: Internal backend file stream pipeline strictly checks magic strings before storing in persistent volumes.
3. **Verify**: Storage middleware aborts data stream, dumps corrupt file shards, and replies with `400 Bad Request (INVALID_FILE_TYPE)`.

## 5. Offline Boot Tests
1. **Action**: A perfectly synced standard digital sign device is abruptly rebooted without active network access (simulating router failure).
2. **Verify**: Kiosk OS activates on boot intent, successfully identifies dead network layer, opens pre-populated internal SQLite layout tables.
3. **Verify**: UI loop reliably mounts cached media representations to DOM and functions unbothered through previously verified scheduled rotation content.
