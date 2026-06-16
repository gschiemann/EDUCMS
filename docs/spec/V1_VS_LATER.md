# V1 Scope Boundaries vs. Future Roadmap

## In Scope for V1 (The Foundation)
- Rigid hierarchical multi-tenancy (Districts -> Schools -> Screen Groups).
- Strictly enforced Role-Based Access Control (Super Admin, District Admin, School Admin, Contributor, Viewer).
- Admin-triggered manual emergency overrides (Lockdown, Weather closures).
- Teacher asset submission and Admin approval-gate workflows.
- Hardware-agnostic player provisioning (Pairing codes) and standard network heartbeat.
- Immutable system audit logs for critical actions (emergencies, user creation/deletion, content approval).
- Offline-first media playback via local storage, reconciling play logs on network reconnect.

## OUT of Scope for V1 (Deferred / Future "Later" Phases)
- **Autonomous Threat Detection:** No integrations with AI cameras for weapon detection, no acoustic gunshot detection hooks.
- **Tactical Routing:** No dynamic wayfinding algorithms (e.g., changing exit arrows on digital signage based on active shooter locations).
- **Automated First Responder Dispatch:** V1 does not automatically dial 911, lock automated doors, or integrate with CAD (Computer Aided Dispatch) systems.
- **Biometric Authentication:** No FaceID/Fingerprint logins for screen control or admin panels.
- **Live Video Streaming:** No capability to stream real-time IP camera feeds to the signage endpoints.
- **Complex Interactivity:** Screens are non-interactive displays. No touch-screen programmatic logic or interactive wayfinding kiosks for V1.
