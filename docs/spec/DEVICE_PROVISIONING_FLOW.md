# Device Provisioning Flow

## 1. Goal
Convert an off-the-shelf Android TV box or panel into a trusted, managed digital signage endpoint with zero-touch or minimal-touch operations.

## 2. Provisioning States
*   **STATE_AWAITING_NETWORK:** Box boots, requests Wi-Fi/Ethernet.
*   **STATE_SHOWING_PIN:** Box displays a unique, randomly generated 6-digit PIN on the screen.
*   **STATE_AUTHENTICATING:** Box is negotiating JWT/certificates with the backend.
*   **STATE_PROVISIONED:** The device is bound to a tenant and screen group.

## 3. The Flow (Minimal Touch)
1.  **Boot Phase:** The app launches on a new device. It detects no active token or Device ID.
2.  **Registration Request:** The device generates a secure UUID and a temporary pairing key. It POSTs to `/api/v1/devices/register-intent`.
3.  **Display PIN:** The backend returns a short-lived 6-digit PIN. The screen displays: "Register this screen at cms.school.edu/link using PIN: XXXXXX".
4.  **Admin Action:** IT Admin logs into the CMS, clicks "Add Screen", and enters the PIN. They assign standard metadata (Location, School, Screen Group).
5.  **Polling:** Meanwhile, the device polls `/api/v1/devices/status/{uuid}` every 3 seconds.
6.  **Token Exchange:** Once the admin links the PIN, the polling endpoint returns a long-lived JWT or cryptographic identity payload.
7.  **Finalization:** The device securely stores this token in encrypted SharedPreferences or Android Keystore, initiates a WebSocket connection, and transitions into `STATE_SYNCING`.

## 4. Pre-Provisioned / Zero-Touch Model (Future Scope)
*   For enterprise bulk rollouts, devices can be provisioned via Android Zero-Touch Enrollment or USB flash drive containing an encrypted `provisioning.json` configuration file, bypassing the PIN entry.
