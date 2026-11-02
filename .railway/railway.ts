// Railway Infrastructure as Code for the production environment of project
// "graceful-embrace" (2d8edbea-e22a-4e0a-87b9-aee793d0ab45).
//
// Generated 2026-11-01 by `railway config migrate --show --variables unmanaged`
// from the LIVE dashboard configuration and committed verbatim (Foundry Standard
// Article 35: version everything; Article 46: Config as Code stops being read on
// 2026-12-01 — `railway config migrate status` already reports that no service
// in production reads railway.json / railway.toml).
//
// Facts this file settles that the rulebook had to call "unverified":
//   - `watchPatterns` on the api service include `scripts/**` and `package.json`
//     and exclude docs: a docs-only merge does not redeploy; a change under
//     scripts/ or to package.json does.
//   - `checkSuites: false` on both services: Railway deploys a master commit on
//     push WITHOUT waiting for GitHub check suites. Turning this on ("deploy only
//     on green", Article 28) is a one-line change here — but it waits for EVERY
//     check suite on the commit, so it must follow the risk-weighted required
//     checks and the flaky-test quarantine, or a red advisory job blocks every
//     deploy (master's E2E was red on 2026-11-01).
//   - Variables are UNMANAGED: secrets stay in the Railway dashboard and are
//     never written to this repository.
//
// This file is not yet applied: `railway config migrate cutover` (reversible with
// `undo`) and any `apply` of this file are consequential (L2) — the owner's written
// go, then the lead runs them. Until then the dashboard is authoritative and this
// file is its versioned mirror; re-generate and diff it whenever a setting changes.
import { defineRailway, github, project, redis, service, volume } from "railway/iac";

export default defineRailway(() => {
  const Redis = redis("Redis", { region: "us-west2" });
  Redis.deploy = { startCommand: "/bin/sh -c \"rm -rf $RAILWAY_VOLUME_MOUNT_PATH/lost+found/ && exec docker-entrypoint.sh redis-server --requirepass $REDIS_PASSWORD --save 60 1 --dir $RAILWAY_VOLUME_MOUNT_PATH\"" };
  Redis.networking = { privateNetworkEndpoint: "redis" };
  const redisVolume = volume("redis-volume", { alerts: { usage: { "100": {}, "80": {}, "95": {} } }, allowOnlineResize: true, region: "us-west2", sizeMB: 5000 });
  // CORRECTED from the export (2026-11-01). The export carried the api service's
  // `start: ./scripts/railway-start.sh` and `healthcheck: /api/v1/health/started`
  // on the renderer too — the root railway.json deploy section leaking onto every
  // service that builds from the repo root. The LIVE renderer is healthy and runs
  // its image's own CMD (`node dist/main.js`, logs: "renderer listening … chromium
  // launched"), and apps/renderer/README.md specifies healthcheck `/health` with a
  // 120 s timeout. Applying the exported values would have broken the renderer.
  const renderer = service("renderer", {
    source: github("gschiemann/EDUCMS", { branch: "master", checkSuites: false }),
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "apps/renderer/Dockerfile", watchPatterns: ["apps/renderer/**", "pnpm-lock.yaml", "pnpm-workspace.yaml", "package.json"] },
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "us-west2": 1 },
  });
  const api = service("api", {
    source: github("gschiemann/EDUCMS", { branch: "master", checkSuites: false }),
    build: { buildCommand: "pnpm --filter api build", buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile", watchPatterns: ["apps/api/**", "packages/database/**", "packages/api-types/**", "packages/scoreboard-cts/**", "packages/signage-design/**", "Dockerfile", "railway.json", "scripts/**", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json"] },
    start: "./scripts/railway-start.sh",
    healthcheck: "/api/v1/health/started",
    healthcheckTimeout: 300,
    replicas: { "us-west2": 1 },
  });

  return project("graceful-embrace", {
    variables: { managed: false },
    resources: [renderer, api, Redis, redisVolume],
  });
});
