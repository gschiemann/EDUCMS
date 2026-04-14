# Infrastructure Environment Plan

## Environments

| Environment | Purpose | Infrastructure | Access |
|---|---|---|---|
| Local | Developer testing | Docker Compose (App, DB, Redis) | Developer machines |
| Dev | Integration testing | Managed K8s / ECS (1 replica per service) | Internal VPN only |
| Staging | Pre-prod, UAT, QA | Managed K8s / ECS (matches prod topology) | Internal VPN + Client whitelisting |
| Prod | Live production | Managed K8s / ECS (Multi-AZ, 3+ replicas) | Public internet (WAF protected) |

## Minimum School-Safe Production Baseline
- All traffic over HTTPS (TLS 1.2+ mandatory, TLS 1.3 preferred).
- Web Application Firewall (WAF) with OWASP Top 10 mitigation and aggressive rate limiting.
- Strict isolation of multitenant data (logical separation via Row-Level Security / tenant IDs).
- SOC2 compliant cloud infrastructure provider.
- DDoS protection enabled on all public endpoints.
- Vulnerability scanning active on all container images prior to deployment.

## Network Segmentation & Firewall Assumptions
- **Signage Network**: Devices MUST be placed on a dedicated VLAN physically or logically separate from staff, student, and guest networks to prevent lateral movement attacks.
- **Firewall Assumptions**: Schools typically implement strict egress filtering and deep packet inspection (DPI). The platform must operate seamlessly in these restricted environments and handle proxy certs if required.

## Device Outbound Traffic Requirements
Signage devices require outbound access to the following:
- **Port 443 (TCP)**: Primary communication channel with the CMS API and WebSocket endpoints.
- **Port 80 (TCP)**: Only permitted for initial HTTP to HTTPS redirection or captive portal checks.
- **Port 123 (UDP)**: NTP access for accurate time synchronization for local scheduling.
- **Target FQDNs**:
  - `api.schoolsigns.example.com` (Control Plane)
  - `ws.schoolsigns.example.com` (Realtime Emergency/Heartbeats)
  - `cdn.schoolsigns.example.com` (Media Asset Downloads)
