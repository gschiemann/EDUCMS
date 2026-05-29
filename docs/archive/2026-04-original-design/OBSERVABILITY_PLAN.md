# Observability and Alerting Plan

## Log Aggregation
- **Strategy**: All application components, including databases and gateways, output JSON-formatted, structured logs to `stdout`/`stderr`.
- **Collector**: A lightweight agent like FluentBit or Promtail deployed as a scalable DaemonSet across the cluster.
- **Storage/Analysis**: Centralized log aggregation platform (e.g., Datadog, ELK Stack, Grafana Loki).
- **Context Preservation**: Every log line includes trace IDs, tenant IDs, and component names to enable rapid contextual filtering.

## Audit Log Retention
- **Requirement**: Unalterable, immutable audit logs for all security-sensitive actions (administrative logins, access role changes, emergency broadcast triggers, screen overrides).
- **Retention Period**: Minimum of 7 years in WORM (Write Once Read Many) cold storage (e.g., AWS S3 Glacier with Object Lock) to satisfy potential school district legal and compliance demands.
- **Data Captured**: User ID, IP Address, Timestamp, Action Performed, Affected Resource ID, Before/After system state.

## Alerting
- **Platform**: PagerDuty, Opsgenie, or similar, directly integrated with engineering Slack/Teams channels.
- **Severity Levels**:
  - **P1 (Critical)**: Total system outflow, API complete failure, Emergency WebSocket system down, Database failover event. Action: Immediate phone call/SMS to on-call engineer.
  - **P2 (High)**: Degraded performance, single AZ failure, partial WebSocket disconnect spike, latency > 2000ms. Action: Immediate page and Slack notification.
  - **P3 (Warning)**: High CPU/Memory usage approaching limits, unusual (but not catastrophic) error rate spikes. Action: Slack notification for business-hours review.
- **Core Metrics Tracked**: 
  - RED metrics (Rate, Errors, Duration) for all API boundaries.
  - USE metrics (Utilization, Saturation, Errors) for infrastructure.
  - WebSocket connection counts, heartbeat latency, and unexpected drop rates.
