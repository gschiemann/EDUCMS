/**
 * Bug Reporter — shared contract between web + api.
 *
 * 2026-05-27 — Operator vision: "the best bug reporter ever seen
 * before where someone finds a bug, clicks a button, it screen caps
 * the issue, it grabs the backend info you need, it records the
 * users info and time stamp then feeds it directly to you, then you
 * find the issue and the fix and then just ask my approval and we
 * fix the fucking issue, things are resolved in record fucking time
 * like no one has ever seen before in real life".
 *
 * Pipeline:
 *   operator hits a bug
 *     → clicks the floating Report Bug button (or Cmd+Shift+B)
 *     → frontend builds a BugCapturedContext bundle
 *     → POST /api/v1/bugs with the bundle
 *     → server enriches with BugServerContext (recent AuditLog, license
 *       state, deploy SHA, infra health) — synchronous before insert
 *     → row created, status=NEW
 *     → background AI analyzer fires: Anthropic API gets the full
 *       bundle + codebase context, returns a BugAiAnalysis
 *     → row updated, status=PROPOSED
 *     → /super/bugs review page surfaces the row with screenshot,
 *       AI analysis, suggested diff
 *     → admin clicks [Approve & Ship] → backend opens a GitHub PR
 *       with the AI's suggested patch
 *     → CI runs, deploys land, admin merges, fix ships
 *
 * Every shape on this page is JSON-serializable. The Prisma Bug row
 * stores capturedContext / serverContext / aiAnalysis as Json columns
 * — these interfaces describe what's inside.
 */

// ─── Status state machine ──────────────────────────────────────────

export type BugStatus =
  | 'NEW'        // just created, no AI yet
  | 'ANALYZING'  // AI request in flight
  | 'PROPOSED'   // AI analysis written, awaiting admin review
  | 'APPROVED'   // admin clicked Approve & Ship, branch/PR created
  | 'SHIPPED'    // fix merged to master + deployed
  | 'REJECTED'   // admin clicked Reject (with reason)
  | 'DUPLICATE'; // linked to another bug id (set rejectedReason='dup:<bugId>')

/** Every status that ends the bug's lifecycle. */
export const BUG_TERMINAL_STATUSES: ReadonlyArray<BugStatus> = [
  'SHIPPED',
  'REJECTED',
  'DUPLICATE',
];

// ─── Capture bundle (client-side) ─────────────────────────────────

/**
 * One entry in the user-action breadcrumb ringbuffer. The client logs
 * up to ~50 of these and ships them on bug submit so the AI can see
 * what the operator was doing immediately before they hit the bug.
 *
 * The set is INTENTIONALLY small + structured — the ringbuffer is
 * always-on (every click + nav, on every page) so each entry needs to
 * be cheap to record and cheap to ship.
 */
export interface BugBreadcrumb {
  /** ms-since-epoch when this happened. */
  ts: number;
  type: 'click' | 'nav' | 'mutation' | 'console' | 'network' | 'state-change';
  /** Free-text label — e.g. "Pair Screen button", "/dodgers/playlists",
   *  "POST /api/v1/playlists/abc/items", "useUIStore.logout()". */
  label: string;
  /** Optional extra data — keep small (max ~200 chars stringified). */
  data?: Record<string, unknown>;
}

/** A single failed network request captured by the fetch wrapper. */
export interface BugNetworkFailure {
  ts: number;
  method: string;
  url: string;
  status: number | null;
  /** ms — time from request to failure */
  durationMs: number;
  /** First ~500 chars of the error message or response body. */
  message?: string;
}

/** A single console.error / console.warn captured by the early console wrapper. */
export interface BugConsoleEntry {
  ts: number;
  level: 'error' | 'warn';
  /** First ~1000 chars of the joined args, JSON-stringified for non-strings. */
  message: string;
  /** Optional stack trace, truncated to ~2 KB. */
  stack?: string;
}

/** What the player / dashboard knows about itself when the bug was filed. */
export interface BugClientBrowserInfo {
  userAgent: string;
  /** From navigator.language. */
  language: string;
  /** window.innerWidth × window.innerHeight (CSS px). */
  viewport: { w: number; h: number };
  /** window.devicePixelRatio — useful to spot 4K vs 1080p screens. */
  dpr: number;
  /** Detected Chromium major version, or null when not Chromium. */
  chromiumMajor: number | null;
  /** Result of @/lib/capabilities detectCapabilities() — feature support
   *  matrix the dashboard already collects for diagnostics. */
  capabilities?: Record<string, unknown>;
}

/** Subset of the React Query QueryClient cache state that helps debugging.
 *  Each entry is `{ queryKey, state, dataPresent }` — we DON'T ship raw data
 *  (PII risk, payload size) but we tell the AI which queries existed + what
 *  their lifecycle state was at bug time. */
export interface BugReactQueryEntry {
  queryKey: string; // JSON-stringified
  state: 'idle' | 'loading' | 'success' | 'error';
  dataPresent: boolean;
  errorMessage?: string;
  fetchedAt?: number;
}

/** The full client-captured bundle that ships on POST /api/v1/bugs.
 *  Stored verbatim in Bug.capturedContext (Postgres Json). */
export interface BugCapturedContext {
  /** Schema version — bump when fields change in a non-additive way. */
  v: 1;
  /** ms-since-epoch on the CLIENT at submit time. */
  clientTs: number;
  /** Current URL incl. query string. */
  url: string;
  /** Just the pathname for index queries. */
  pathname: string;
  /** Free-text title (document.title). */
  pageTitle: string;
  /** Optional operator description — what they were trying to do. */
  description?: string;
  /** Reporter identity (also re-derived server-side from session for
   *  trust; this copy is for debugging in case of session weirdness). */
  reporter: {
    userId: string;
    email: string;
    role: string;
    tenantId: string | null;
    tenantSlug: string | null;
    tenantVertical?: string | null;
  };
  browser: BugClientBrowserInfo;
  breadcrumbs: BugBreadcrumb[];
  networkFailures: BugNetworkFailure[];
  consoleEntries: BugConsoleEntry[];
  reactQuery: BugReactQueryEntry[];
  /** Any feature flag values (GrowthBook etc.) the client was using. */
  featureFlags?: Record<string, unknown>;
  /** Git SHA the operator's FRONTEND bundle was built from (baked in at
   *  build time via NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA / NEXT_PUBLIC_BUILD_SHA).
   *  Lets a reviewer tell a stale-tab report from a live-bundle bug. */
  buildSha?: string;
  /** The live deployment's SHA at submit time (best-effort fetch of
   *  /api/build-info). Undefined when offline / the fetch failed. */
  buildLiveSha?: string;
  /** true ⇔ buildSha and buildLiveSha disagree — the operator's tab was on a
   *  stale bundle (so the bug may already be fixed; have them hard-refresh). */
  buildIsStale?: boolean;
}

// ─── Server-side enrichment ───────────────────────────────────────

/**
 * Compact AuditLog snapshot — JUST the fields useful for the AI's
 * reasoning, none of the bulky details unless they fit.
 */
export interface BugAuditSnapshot {
  ts: string; // ISO
  action: string;
  targetType: string | null;
  targetId: string | null;
  /** First ~500 chars of details JSON. */
  details: string | null;
  userId: string | null;
}

export interface BugServerContext {
  v: 1;
  /** ms-since-epoch on the SERVER at enrichment time. */
  serverTs: number;
  /** Last N AuditLog rows where userId = reporter. */
  reporterAuditLog: BugAuditSnapshot[];
  /** Last N AuditLog rows where tenantId = reporter's tenant (excluding
   *  reporter's own rows to avoid duplication). */
  tenantAuditLog: BugAuditSnapshot[];
  /** Current commit SHA the API container booted from. */
  apiCommitSha: string | null;
  /** API uptime in seconds — flags "this happened right after a deploy". */
  apiUptimeSec: number | null;
  /** Postgres / Redis health at bug time. */
  infraHealth: {
    db: 'ok' | 'degraded' | 'down';
    redis: 'ok' | 'degraded' | 'down';
  };
  /** Tenant's current license (Stripe state) — useful when bug is
   *  payment / billing related. */
  license?: {
    tier: string | null;
    seatLimit: number | null;
    currentSeats: number | null;
    expiresAt: string | null;
  };
}

// ─── AI analysis output ───────────────────────────────────────────

/**
 * Each file the AI thinks is affected by the bug. The diff is a
 * unified-diff style patch the operator can preview + approve.
 */
export interface BugAiFileChange {
  filePath: string;
  /** Why this file is touched — one sentence. */
  reason: string;
  /** Unified-diff patch the operator will see in the review page. */
  diff: string;
}

/**
 * The structured output the AI analyzer returns. Stored in
 * Bug.aiAnalysis (Json). The Anthropic API call is prompted to emit
 * EXACTLY this shape (response_format / tool_use).
 */
export interface BugAiAnalysis {
  v: 1;
  /** One-paragraph plain-English explanation of what's broken. */
  rootCause: string;
  /** Files the AI proposes to change. */
  filesAffected: BugAiFileChange[];
  /** AI's self-rated confidence 0-100. <70 should be flagged "human
   *  please verify" — the auto-merge path won't fire below this. */
  confidence: number;
  /** Optional alternative diagnoses the AI considered but ranked
   *  lower — useful for the operator to see in case the top theory
   *  is wrong. */
  alternatives?: Array<{ rootCause: string; confidence: number }>;
  /** A Playwright / shell command the operator can run to verify
   *  the fix worked. */
  testPlan?: string;
  /** When this analysis was generated (ms). */
  analyzedAt: number;
}

// ─── API contracts ─────────────────────────────────────────────────

/** POST /api/v1/bugs */
export interface CreateBugRequest {
  /** The full client-side bundle. */
  captured: BugCapturedContext;
  /** Optional base64-encoded screenshot. Backend uploads to Supabase
   *  storage and stores the public URL on Bug.screenshotUrl. */
  screenshotBase64?: string;
}

export interface CreateBugResponse {
  bugId: string;
  /** Status the row was inserted with — usually 'NEW' or 'ANALYZING'. */
  status: BugStatus;
  /** Set when the AI analyzer was kicked off synchronously enough that
   *  the row already has aiAnalysis. Usually false for v1 (analysis
   *  happens async, see /api/v1/bugs/:id polling). */
  analysisReady: boolean;
}

/** GET /api/v1/bugs (SUPER_ADMIN only) */
export interface BugListItem {
  id: string;
  createdAt: string;
  status: BugStatus;
  description: string | null;
  screenshotUrl: string | null;
  reporter: {
    userId: string | null;
    email: string | null;
    tenantSlug: string | null;
  };
  pathname: string | null;
  aiConfidence: number | null;
}

/** GET /api/v1/bugs/:id (SUPER_ADMIN only) */
export interface BugDetail extends BugListItem {
  capturedContext: BugCapturedContext;
  serverContext: BugServerContext | null;
  aiAnalysis: BugAiAnalysis | null;
  aiCostUsd: number | null;
  approvedById: string | null;
  approvedAt: string | null;
  fixBranchName: string | null;
  fixPrNumber: number | null;
  fixCommitSha: string | null;
  shippedAt: string | null;
  rejectedReason: string | null;
}

/** POST /api/v1/bugs/:id/approve */
export interface ApproveBugRequest {
  /** Optional override notes from admin — shipped as the PR description. */
  notes?: string;
}

export interface ApproveBugResponse {
  bugId: string;
  status: BugStatus;
  /** GitHub PR URL when the API was able to create one. Null when the
   *  GitHub integration isn't configured — the admin will see the
   *  suggested diff and apply manually. */
  prUrl: string | null;
  branchName: string | null;
}

/** POST /api/v1/bugs/:id/reject */
export interface RejectBugRequest {
  reason: string;
  /** Optional bugId of the bug this duplicates — sets status=DUPLICATE
   *  instead of REJECTED + writes "dup:<bugId>" to rejectedReason. */
  duplicateOfBugId?: string;
}

/** POST /api/v1/bugs/:id/iterate — ask AI to rethink with notes. */
export interface IterateBugRequest {
  /** Admin's hint — "the fix should also handle X". */
  notes: string;
}

// ─── Constants the frontend + backend share ────────────────────────

/** Rate limit per user: max bugs they can submit per hour. */
export const BUG_SUBMIT_RATE_LIMIT_PER_USER_PER_HOUR = 20;

/** Max screenshot size in bytes the API accepts. Anything larger is
 *  rejected and the frontend instructed to re-capture at lower DPI. */
export const BUG_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/** Max combined captured-context JSON size in bytes. */
export const BUG_CAPTURED_CONTEXT_MAX_BYTES = 512 * 1024; // 512 KB
