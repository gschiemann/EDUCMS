# Deployment Architecture

## Containerization Strategy
- **Application Services**: Delivered as stateless Docker containers.
- **Base Images**: Minimal surface area images (e.g., Alpine Linux or Google Distroless) utilized to radically reduce exploit vulnerabilities.
- **Immutability**: Image tags are strictly immutable. Every deployment uses a uniquely versioned SHA or semantic version tag. `latest` tags are prohibited in production.

## Network Architecture & Edge
### TLS Termination
- TLS is terminated exclusively at the Edge/Load Balancer layer (e.g., AWS ALB, Cloudflare, or NGINX ingress).
- Internal traffic between the Load Balancer and compute nodes uses internal mTLS (Mutual TLS via service mesh) for defense-in-depth, ensuring communication between microservices is encrypted and authenticated.

### HSTS Enforcement
- Strict HTTP Strict Transport Security (HSTS) is enforced at the edge for all domains.
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

### CDN & Object Storage
- **Object Storage**: S3-compatible service used for storing all media assets (images, videos). Data is encrypted at rest using provider-managed keys (SSE-S3/KMS).
- **CDN**: A distributed CDN (e.g., CloudFront, Cloudflare) caches static client assets and media at the edge to reduce latency and save bandwidth at the school's local network.
- The CDN exclusively utilizes signed URLs with short expirations to prevent unauthorized hotlinking or scraping of tenant media.

## Deployment Model
### Blue/Green & Rolling Deployment
- **Methodology**: Blue/Green deployments for core API and WebSocket services to ensure zero downtime.
- **Active Connections**: WebSockets are gracefully drained during the switch; clients are instructed to reconnect to the new cluster.
- **Database Migrations**: Executed in a strictly backward-compatible manner (expand-and-contract pattern) prior to the blue/green traffic switch. 
- **Rolling**: Minor updates or background worker nodes can utilize standard rolling deployments.

### Rollback Plan
- Automatic rollback is triggered if health checks, latency thresholds, or error rates breach acceptable limits during the blue/green verification phase.
- Re-routing traffic back to the "Blue" environment at the load balancer level ensures instant recovery without requiring container redeployment.
