# Security Baseline & Controls

## 1. Cryptography & Data Protection
*   **Password Hashing**: Mandatory use of **Argon2id**.
*   **Salting**: Mandatory **per-password random salt**, generated securely and stored alongside the hash.
*   **Encryption In-Transit**: Strict transport assumptions. **HTTPS** is mandatory for all inbound and outbound API traffic.
*   **HSTS**: HTTP Strict Transport Security (HSTS) must be enforced with a long max-age, including subdomains and preload directives.

## 2. Authentication & Sessions
*   **Session ID Rotation**: Session identifiers must be strictly rotated explicitly upon successful login or privilege elevation.
*   **Token Strategy**: 
    *   **Short-lived Access Tokens (AT)**: 15-30 minutes maximum lifetime.
    *   **Secure Refresh Strategy**: Refresh tokens (RT) must be stored securely (HttpOnly cookies for web) and rotated upon use (Refresh Token Rotation).
*   **Web Authentication**: Mandatory **secure cookie strategy** if browser auth is used (`HttpOnly`, `Secure`, `SameSite=Strict`).

## 3. Defense Against Abuse
*   **Rate Limiting**: Mandatory IP and User-based rate limiting on all endpoints, with aggressive strictures on authentication and password reset routes.
*   **Anomaly Detection**: Mandatory **IP/device anomaly logging**. Monitor for sudden geographic shifts (`impossible travel`), brute force metrics, and credential stuffing vectors.

## 4. Input/Output Security
*   **Content Security Policy (CSP)**: Strict CSP headers enforced on the admin frontend to prevent unapproved script execution, restricting object-src, script-src, and frame-src.
*   **HTML Sanitization**: Implementation of a strict, allowlist-based **HTML sanitization policy** (e.g., using DOMPurify or similar robust library) before rendering any user-provided textual content.
*   **Asset URLs**: Use of **signed asset URLs** with expiration timeouts for serving media, preventing direct unauthenticated iteration/download of tenant payloads.
*   **Upload Scanning**: Mandatory **malware scanning** for all uploaded images and videos before they are marked as `READY` for sync.

## 5. Audit & Compliance
*   **Immutable Audit Logs**: All privileged actions (e.g., CRUD on users, changes to RBAC, configuration updates, emergency overrides) must be recorded to an **immutable**, append-only log store.
*   **Log Context**: Audit logs must include Actor ID, Action, Subject ID, Timestamp, IP Address, and Before/After state diffs.
