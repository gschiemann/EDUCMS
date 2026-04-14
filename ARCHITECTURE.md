# Backend Architecture: Secure School CMS

## Platform Overview
The system is a multi-tenant Node.js/TypeScript REST API (or comparable modern framework) designed to manage digital signage across school districts. It focuses on offline-first reliability for signage players, stringent security constraints, and highly auditable workflows.

## Multi-Tenant Structure
The core hierarchy relies on boundaries at the `District` and `School` levels.
- **Districts** are the top-level entity.
- **Schools** belong to Districts. 
- **Users** gain access via `Memberships` that map them to roles at either the District or School level. All requests must inherently scope data access to the user's permitted contexts.

## Security Posture & Hardening
- **Authentication:** All authentication state relies on a secure Session Identifier, rotated upon every successful login and role escalation.
- **Password Hashing:** Passwords are cryptographically hashed using **Argon2id** with random per-password salting parameters.
- **Database Access:** 100% Parameterized queries using modern ORMs/Query Builders. Raw SQL is strictly banned unless comprehensively parameterized and peer-reviewed.
- **Transport Security:** Strict enforcement of HTTPS and HSTS. The application rejects all unsecured connections.
- **Input Validation:** Whitelist-based validation for all endpoints, especially for sort/filter fields to prevent injection or DoS.
- **CSRF Protection:** Anti-CSRF tokens enabled on all mutating state endpoints (POST, PUT, DELETE) where applicable.

## Device Provisioning & Token Lifecycle
1. Devices (Screens) are initially provisioned with a secure, one-time enrollment token by a school administrator.
2. Upon enrollment, the device is issued a distinct `device_token` (JWT or cryptographically secure random string).
3. The device token is strictly tied to the hardware and is rotated periodically.
4. Tokens can be revoked instantly from the administrative panel, disconnecting the player automatically.

## Auditing & Compliance
**Every** privileged action (creation, updates, deletions, publishing, device provisioning, role changes) requires logging in the `audit_log` table.
The system captures the Actor ID, Target Entity, Before/After Payload, IP Address, and precise Timestamp, adhering to compliance standards for school safety tools.

## High-Level API Structure
- **Admin APIs:** Manage schools, districts, roles, users, and audit logs.
- **Contributor APIs:** Manage media assets, playlists, and schedules. Requires asset validation.
- **Device APIs:** Heartbeats, status updates, and manifest synchronization.
- **Override APIs:** Emergency triggers (e.g., Lockdown, Weather) that instantly preempt all schedules.
