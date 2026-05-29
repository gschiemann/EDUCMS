# Backup and Disaster Recovery Plan

## Database Backup Strategy
- **Technology**: Managed Relational Database Service (e.g., AWS RDS PostgreSQL).
- **Automated Backups**: Daily full instance snapshots configured with a strict 30-day retention policy.
- **Point-in-Time Recovery (PITR)**: Write-Ahead Logs (WAL) are automatically archived to object storage, enabling up-to-the-minute point-in-time recovery for the last 30 days.
- **Cross-Region Resilience**: Snapshots are automatically replicated to a secondary, geographically isolated region to prepare for extreme disaster scenarios (e.g., full region loss).

## Redis Availability Strategy
- **Architecture**: Managed Redis (e.g., ElastiCache or Redis Enterprise) deployed in a highly available, Multi-AZ configuration.
- **Failover**: Automatic failover to a standby replica is executed within seconds if the primary node suffers a failure.
- **Recovery and Volatility**: Redis is treated as mostly ephemeral (used for caching, queuing, and WebSocket session states). If total Redis loss occurs, state reconciliation algorithms on Android devices and API worker nodes will gracefully reconstruct WebSocket connections and system state upon recovery.

## Disaster Recovery Model
### RTO and RPO Goals
- **Recovery Time Objective (RTO)**: 1 Hour (maximum acceptable time to restore core signage functionality in a secondary failover region).
- **Recovery Point Objective (RPO)**: 5 Minutes (maximum acceptable data loss prior to failover).

### Complete Failover Execution Plan
1. **Detection**: Global synthetic monitoring detects total region failure and fires P1 alerts.
2. **Database Promotion**: The existing Read-Replica in the designated secondary region is decoupled and promoted to Primary.
3. **Infrastructure Scaling**: GitOps pipelines and Infrastructure as Code validate and scale up compute nodes (API, workers) from zero to production capacity in the secondary region.
4. **Traffic Rerouting**: Global Load Balancer / DNS Routing (e.g., AWS Route53) updates health checks and fails over routing to point endpoints to the newly promoted secondary region.
5. **Stakeholder Notification**: Automated and manual notifications broadcasted to internal operations and district clients regarding the failover event and operational status.
