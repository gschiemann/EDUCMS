# Security Test Plan & Launch Gates

## 1. Automated Security Testing Requirements
*   **SAST (Static Application Security Testing)**: Must run on every pull request. Must pass with ZERO High or Critical severity findings.
*   **DAST (Dynamic Application Security Testing)**: Run against staging environments to identify runtime configuration issues, headers misconfigurations, and XSS vulnerabilities.
*   **Dependency Auditing**: Pipeline must fail if dependencies have unpatched High/Critical CVEs.

## 2. Threat Model Validation Scenarios

| Threat Category | Validation Execution | Expected Result |
|-----------------|----------------------|-----------------|
| **Broken Object-Level Auth (BOLA)** | Automated integration tests call each tenant-scoped endpoint using tokens belonging to a different tenant. | System returns `403 Forbidden` or `404 Not Found`. Data remains isolated. |
| **RBAC Escalation** | Test suites log in as `Content Creator` and attempt to trigger an emergency override endpoint. | System returns `403 Forbidden`. Action is not executed. |
| **Credential Attacks** | Execute a local brute force script against staging login. Try 50 passwords for a single user. | IP and User are rate-limited / locked out. Alert generated in SIEM. |
| **Payload Injection** | Fuzz all text input fields with deeply nested, obfuscated `<script>` tags and SQL artifacts. | Inputs are either sanitized (HTML) or rejected. API remains stable. |
| **Asset Pipeline** | Upload the EICAR test file disguised as `urgent-banner.png`. | Malware scanner detects EICAR, quarantines file, and prevents status from becoming `READY`. |
| **Event Replay** | Intercept a valid WebSocket `trigger_override` payload. Send an identical payload 60 seconds later. | Server rejects the payload due to timestamp expiration or reused nonce. |

## 3. Production Rollout Security Gates
The following items are **MANDATORY** release blockers. They must be validated and signed off before any production deployment.

- [ ] **Gate 1: Third-Party Penetration Test**: A grey-box penetration test has been completed against a production-like staging environment. All High/Critical findings are remediated.
- [ ] **Gate 2: Cryptography Alignment**: Argon2id hashing implementation is verified, including unique salt generation and memory parameters calibrated for the host environment.
- [ ] **Gate 3: Session Security Verification**: Verification that logging in immediately rotates the active session ID, and `HttpOnly`/`Secure`/`SameSite` flags are explicitly verified on auth cookies.
- [ ] **Gate 4: Secrets Management**: No hardcoded secrets exist in the repository. All DB credentials, API keys, and signing secrets are managed via a secure vault (e.g., AWS Secrets Manager/Hashicorp Vault), injected at runtime.
- [ ] **Gate 5: WAF & Rate Limiting**: The Web Application Firewall is in front of the production environment in blocking mode. Global and route-specific rate limiters are verified active.
- [ ] **Gate 6: Immutable Auditing**: The infrastructure provisioning proves that application containers do not have mutate/delete access to the centralized audit logging store.
