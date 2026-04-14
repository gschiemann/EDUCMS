# User Workflows (V1)

## 1. Approval-Friendly Teacher Workflow (Content Submission)
1. **Upload:** Teacher logs into CMS, selects "Upload Asset".
2. **Details:** Teacher adds title, optional metadata, and selects desired playback dates/target Screen Group.
3. **Submit:** Teacher clicks "Submit for Approval". 
   - *Status changes to Pending Approval.*
4. **Notification:** School Admin sees notification in dashboard.
5. **Review:** Admin reviews asset thumbnail, details, and target screens.
6. **Decision:** 
   - *Approve:* Asset is marked active and injected into the appropriate playlist.
   - *Reject:* Asset is returned to Draft with an admin comment (e.g., "Image resolution too low").

## 2. Emergency Override Flow
1. **Trigger:** School Admin clicks prominent red "EMERGENCY" button on the dashboard header.
2. **Confirmation:** System requires a secondary confirmation dual-action (e.g., typing "LOCKDOWN" or checking a high-friction confirmation box) to prevent accidental firing.
3. **Execution:** 
   - System logs the exact user and time in the Audit Log.
   - Websocket/SSE fires an immediate event to all connected players in the school.
   - Offline players verify the emergency state upon next heartbeat.
4. **Playback:** All displays immediately switch to the pre-staged high-contrast emergency asset, overriding all running content.
5. **Disarm (All Clear):** Admin navigates to the active emergency banner, clicks "Issue All Clear", verifies with their password or secondary confirmation. Players resume normal scheduling based on realtime clock.

## 3. Player Provisioning & Heartbeat
1. **Generate Token:** Admin navigates to "Players", clicks "Provision New Player", generating a 6-digit localized pairing code valid for 15 minutes.
2. **Device Startup:** Hardware player boots the signage application, displaying its unique device ID and asking for pairing code.
3. **Pairing:** Admin enters device ID/pairing code.
4. **Assignment:** Admin assigns the newly paired player to a Screen Group.
5. **Initial Sync:** Player downloads its first full payload (assets + schedule) to secure local storage and begins reporting its vitals via standard heartbeat.
