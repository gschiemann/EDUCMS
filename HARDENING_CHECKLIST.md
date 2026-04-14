# System Hardening Checklist

## 1. Network & Infrastructure
- [ ] Platform sits behind a WAF (Web Application Firewall).
- [ ] Strict network isolation between public subnets (Load Balancers) and private subnets (App servers, Data stores).
- [ ] Database instances do not have public IP addresses.
- [ ] DDoS protection mechanisms are enabled (e.g., AWS Shield, Cloudflare).
- [ ] Egress traffic from app servers is restricted to necessary outbound APIs (e.g., Push notifications, Email delivery).

## 2. API & Backend Services
- [ ] All endpoints validate standard Object-Level Authorization (Tenant ID checks vs Caller Identity).
- [ ] Global error handlers do not leak stack traces or internal structure details to clients.
- [ ] Helmet.js (or equivalent) configured for strict security headers on all HTTP responses.
- [ ] Rate limiters are backed by a distributed store (e.g., Redis) to prevent single-node bypass.
- [ ] ORM queries are reviewed to guarantee no raw string interpolation is used, enforcing parameterization.

## 3. Frontend & Browsers
- [ ] Content Security Policy (CSP) headers are validated not to contain `unsafe-inline` or `unsafe-eval`.
- [ ] Anti-CSRF strategies map 1:1 with REST endpoints accepting POST/PUT/DELETE/PATCH.
- [ ] Dependencies audited for known vulnerabilities (e.g., `npm audit` / Dependabot) inside CI/CD gates.
- [ ] All injected user-controlled content goes through a designated HTML sanitizer before being rendered to the DOM.

## 4. Asset Storage (S3 / Blob)
- [ ] Buckets are strictly configured as private. No public read access.
- [ ] Cross-Origin Resource Sharing (CORS) rules on buckets are restricted to the known tenant portals.
- [ ] File uploads are routed temporarily to a quarantine bucket/folder until the Malware Scan Lambda completes.
- [ ] Pre-signed URLs are configured with correct short expiration windows (e.g., 60 minutes).

## 5. Mobile (Android Player)
- [ ] Application signed securely with production keys strictly protected.
- [ ] Storage of API tokens utilizes Android EncryptedSharedPreferences / Keystore System.
- [ ] Application configured to reject user-installed CA certificates to prevent Man-In-The-Middle (MITM) attacks.
- [ ] Kiosk Mode enabled with appropriate restrictions on exiting the app or accessing OS settings.

## 6. Observability
- [ ] Security events (Failed logins, permission denied, locked accounts) are piped to a centralized SIEM / monitoring tool.
- [ ] Alerting configured for anomalous login rates and server error rate spikes.
- [ ] Audit logs write-path is structurally independent from standard application logs to prevent tampering.
