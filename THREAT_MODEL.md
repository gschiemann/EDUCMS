# System Threat Model

## 1. Overview and Scope
This document outlines the threat model for the School Digital Signage CMS, covering the backend API, frontend web applications (admin portal), Android endpoints (players), authentication/session flows, asset storage, and foundational infrastructure.

## 2. Threat Matrix

### 2.1 Authentication & Session Handling
| Threat | Description | Impact | Mitigation Strategy Reference |
|--------|-------------|--------|-------------------------------|
| **Credential Stuffing** | Attackers use leaked credential pairs from other breaches to gain access to teacher or admin accounts. | High (Account Takeover) | Rate limiting, anomaly logging, strong password hashing (Argon2id). |
| **Brute Force Login** | Repeated automated attempts to guess passwords for valid usernames. | High (Account Takeover) | Progressive backoff, IP/device anomaly logging. |
| **Session Fixation** | Attacker sets a known session identifier for a user before they log in, taking over the authenticated session. | High | Session ID rotation upon successful login. |
| **Device Token Theft** | Extraction of the long-lived device identity token from a compromised Android player. | Medium (Device Impersonation) | Hardware-backed keystores, token rotation, binding token to device IP/fingerprint. |

### 2.2 Authorization & Access Control
| Threat | Description | Impact | Mitigation Strategy Reference |
|--------|-------------|--------|-------------------------------|
| **RBAC Abuse** | A principal with legitimate lower-tier access (e.g., Content Creator) finds a way to execute privileged operations (e.g., global emergency override). | Critical | Strict server-side enforcement of RBAC matrix, granular permission checks. |
| **Broken Object-Level Authorization (BOLA)** | A user from `School A` modifies the ID in an API request (e.g., `PUT /api/v1/screens/123`) to modify or view assets from `School B`. | Critical | Tenant-isolation checks and explicit ownership verification on every database query. |
| **Admin Insider Abuse** | A rogue system administrator intentionally alters configuration or deletes data. | Critical | Immutable audit logs, principle of least privilege, two-person rule for destructive actions (future). |

### 2.3 Injection & Input Validation
| Threat | Description | Impact | Mitigation Strategy Reference |
|--------|-------------|--------|-------------------------------|
| **SQL Injection** | Malicious payloads injected into inputs/queries to bypass auth or leak database contents. | Critical | Parameterized queries (via ORM or prepared statements), strict input validation. |
| **Cross-Site Scripting (XSS)** | Injection of malicious scripts via signage text fields that execute in the admin portal or on the player. | High | Context-aware output encoding, strict HTML sanitization, Content Security Policy (CSP). |
| **HTML Payload Injection** | Malicious HTML attributes or tags embedded into valid fields to manipulate presentation or execute scripts. | High | Strict HTML sanitization policy (allowlist-based). |

### 2.4 Integrity & Payload Delivery
| Threat | Description | Impact | Mitigation Strategy Reference |
|--------|-------------|--------|-------------------------------|
| **Cross-Site Request Forgery (CSRF)** | Forcing an authenticated browser to execute unwanted actions on the CMS backend (e.g., triggering an override). | High | SameSite cookie attributes, Anti-CSRF tokens for mutating requests. |
| **Malicious Asset Upload** | Uploading malware embedded in image/video files (e.g., polyglot files, exploited media players). | High | Malware scanning on upload, signature validation, processing assets in isolated sandboxes. |
| **Replay of Override Events** | Intercepting a valid "Trigger Emergency" WebSocket/HTTP packet and replaying it later to cause a false alarm. | Critical | Nonces, strict timestamp validation (time-to-live), and cryptographic signatures for commands. |

### 2.5 Endpoint & Infrastructure
| Threat | Description | Impact | Mitigation Strategy Reference |
|--------|-------------|--------|-------------------------------|
| **Player Tampering** | Physical or logical tampering of the Android device to alter schedules, bypass security, or extract tokens. | Medium | Locked-down kiosk mode, MDM provisioning, secure boot, tamper detection. |
| **Audit Log Integrity** | An attacker (or rogue admin) covers their tracks by modifying or deleting logs of their actions. | Critical | Forward logs to a write-only, immutable logging service. |
