/**
 * One-off close-out script for the three clock-sync bugs filed
 * 2026-05-28 by Greg.
 *
 *   97f54357 — "shot clock can not move forward if game clock paused"
 *              fixed in bb065e3
 *   51494dff — "shot-clock reset auto-starts when game clock is paused"
 *              fixed in bf7cf2d
 *   046d73aa — "game clock + shot clock visually drift by ~1 second"
 *              fixed in 9242bc0
 *
 * For each, we write a `BugAiAnalysis` row directly via Prisma — the
 * usual Anthropic analyzer path is gated on a funded ANTHROPIC_API_KEY,
 * which we deliberately defer to BYOK (CLAUDE.md AI Concierge model).
 * Writing the analysis manually is the same artifact the UI renders for
 * any AI-source, just with `aiProvider = 'claude-via-chat'` so the
 * audit trail makes clear the analysis came from me-via-Claude-Code,
 * not the analyzer microservice.
 *
 * After this script runs, each bug is in PROPOSED state. The
 * /super/bugs/<id> page's [Approve & Ship] button activates; clicking
 * it (Greg, from his SUPER_ADMIN account) fires the BUG_FIX_SHIPPED
 * email via the live API's Resend integration and writes the
 * approvedAt + fixCommitSha rows.
 *
 * We intentionally do NOT auto-approve from here:
 *   - Greg explicitly asked to remain the human-in-the-loop for v1
 *     ("just notify me everytime a bug is submitted... ill then ping
 *     you to fix it")
 *   - Approve emits the Resend email; this script runs in Greg's local
 *     env which doesn't carry RESEND_API_KEY, so the email would never
 *     leave the box.
 *
 * Run:
 *   cd apps/api && npx tsx scripts/close-clock-bugs.ts
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const prisma = new PrismaClient();

type BugAnalysisFile = {
  filePath: string;
  reason: string;
  diff: string;
};
type BugAnalysis = {
  v: 1;
  rootCause: string;
  filesAffected: BugAnalysisFile[];
  confidence: number;
  alternatives?: { rootCause: string; confidence: number }[];
  testPlan?: string;
  analyzedAt: number;
};

const ANALYSES: Record<string, { commitSha: string; analysis: BugAnalysis }> = {
  '97f54357-c5ec-40f9-957c-ef8579c4a55a': {
    commitSha: 'bb065e3',
    analysis: {
      v: 1,
      rootCause:
        'The shot-clock display used a stale snapshot of the shot-clock state captured at the last server tick. When the game clock was paused (clockRunning=false), the local Date.now()-based interpolation that kept the visible game clock "alive" still ran for the game clock display, but the shot clock display only updated when a new server tick landed. So pausing the game clock froze the visible game clock at its true value while the shot clock kept ticking from the snapshot moment forward — exactly the wrong way around. Fix was to make the shot clock display read from the same shared "now" tick the game clock display reads from, and use the shot-clock\'s `running` field (which mirrors game.clockRunning when synced) to gate interpolation. After the fix the two clocks tick / freeze in lockstep on screen because they share the same display-side interpolation loop.',
      filesAffected: [
        {
          filePath: 'apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx',
          reason: 'Unified shot clock display with the game clock display interpolation tick — both now respect clockRunning identically.',
          diff: '',
        },
      ],
      confidence: 92,
      testPlan:
        'Start a game, start clock at 4:20 + 20s shot. After 5s of real time pause the game clock. Visible game clock should freeze at ~4:15 AND visible shot clock should freeze at ~15. Tap Start again — both resume at the same moment.',
      analyzedAt: Date.now(),
    },
  },

  '51494dff-59c4-466a-a46d-54d6d733c0c8': {
    commitSha: 'bf7cf2d',
    analysis: {
      v: 1,
      rootCause:
        'apps/api/src/sports/sports.service.ts:1421 — the shot-clock reset action unconditionally set `running = (len > 0)`, meaning ANY reset (20s, 30s, full possession) made the shot clock start ticking from the new value even when the game clock was paused. This violated the invariant "shot clock cannot tick unless game clock ticks." Fix: `running = game.clockRunning && len > 0`. Now resetting while paused leaves the shot clock holding at the new value; tapping Start (which sets clockRunning=true and atomically resyncs both via syncShotClockToGameClock) brings them both alive together.',
      filesAffected: [
        {
          filePath: 'apps/api/src/sports/sports.service.ts',
          reason: 'Gate shot-clock reset auto-start on game.clockRunning so paused resets don\'t silently re-start the shot clock.',
          diff: '@@ shot-clock reset action @@\n-const running = len > 0;\n+const running = game.clockRunning && len > 0;\n',
        },
      ],
      confidence: 95,
      alternatives: [
        {
          rootCause: 'A separate auto-start-after-score flag could have been racing the reset, but inspecting the action log showed only the reset event firing.',
          confidence: 15,
        },
      ],
      testPlan:
        'Start game, pause clock at 4:00. Click 20s shot-clock reset — shot clock now reads 20 and is FROZEN (not counting down). Click 30s — same. Click Start — game clock + shot clock both start ticking together. Greg\'s exact reproduction in the bug description is the canonical regression test.',
      analyzedAt: Date.now(),
    },
  },

  '046d73aa-e869-4416-b852-2b1f12cb0516': {
    commitSha: '9242bc0',
    analysis: {
      v: 1,
      rootCause:
        'Pure CLIENT-SIDE display rounding mismatch. The server is correct — syncShotClockToGameClock (sports.service.ts:1565-1600) writes both clockUpdatedAt and shotClock.at in one transaction using the same `now: Date.now()`, and reads return both via a single Date.now() pass. The 1-second visual drift Greg perceived comes from the game-clock formatter in apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx:84-86 using Math.floor while the shot-clock display at ~line 1108 uses Math.ceil. On a COUNTDOWN clock these differ by up to 999ms of visible label: `floor(4:00.500/1000)` shows "4:00" then ticks to "3:59" while `ceil(20.500/1000)` shows "21" then ticks to "20". The two clocks were perfectly in sync in milliseconds but the operator saw their text labels disagree by ~1 second because they rounded opposite directions. Pro convention for countdown clocks is ceil (so "0:00" only appears when the clock is genuinely expired, not for the 999ms before). Fix: switch fmtClock to ceil. Net visual effect on the game clock: "4:20" now sticks for 1000ms before ticking to "4:19" — same pixel-on-screen duration as before, just labeled one tick "later" — and the shot clock at 0 aligns exactly with the game clock at its true zero.',
      filesAffected: [
        {
          filePath: 'apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx',
          reason: 'fmtClock now uses Math.ceil to match the shot-clock display rounding and pro countdown-clock convention.',
          diff: '@@ fmtClock @@\n-const m = Math.floor(safe / 60_000);\n-const s = Math.floor((safe % 60_000) / 1000);\n+const totalSec = Math.ceil(safe / 1000);\n+const m = Math.floor(totalSec / 60);\n+const s = totalSec % 60;\n',
        },
      ],
      confidence: 97,
      alternatives: [
        {
          rootCause: 'Server clockUpdatedAt and shotClock.at could be written at different timestamps if syncShotClockToGameClock weren\'t atomic. Reading sports.service.ts:1565-1600 confirmed both use the same `now` Date instance — ruled out.',
          confidence: 5,
        },
      ],
      testPlan:
        'Open a game console. Start clock at 4:20 + 20s shot. As both tick down, eyeball-verify they tick THE SAME LABEL pixel-by-pixel (game clock seconds digit and shot clock label both advance at the same wall-clock instant). At end-of-period: game clock should hit "0:00" exactly when the shot clock\'s underlying ms also hits zero — no 1-second "0:01 / 0" mismatch.',
      analyzedAt: Date.now(),
    },
  },
};

async function main() {
  console.log(`Closing ${Object.keys(ANALYSES).length} clock-sync bugs…\n`);

  for (const [bugId, { commitSha, analysis }] of Object.entries(ANALYSES)) {
    const bug = await prisma.bug.findUnique({ where: { id: bugId } });
    if (!bug) {
      console.log(`  ✗  ${bugId.slice(0, 8)} — not found, skipping`);
      continue;
    }
    if (['APPROVED', 'SHIPPED', 'REJECTED', 'DUPLICATE'].includes(bug.status)) {
      console.log(`  ↷  ${bugId.slice(0, 8)} — already in terminal state ${bug.status}, skipping`);
      continue;
    }

    await prisma.bug.update({
      where: { id: bugId },
      data: {
        aiAnalysis: analysis as any,
        aiAnalyzedAt: new Date(),
        aiProvider: 'claude-via-chat',
        aiModel: null,
        aiCostUsd: 0,
        status: 'PROPOSED',
        // also stash the commit on the bug so Greg sees what code already
        // landed before he clicks Approve. fixCommitSha + fixBranchName
        // are normally set by the approve endpoint — pre-filling them
        // here means the detail page shows "Fix committed: <sha>" right
        // away, no clicking needed to see it.
        fixCommitSha: commitSha,
        fixBranchName: `direct-master:${commitSha}`,
      },
    });

    console.log(
      `  ✓  ${bugId.slice(0, 8)} → PROPOSED (commit ${commitSha}, confidence ${analysis.confidence}%)`,
    );
  }

  console.log(`\nDone. Next step (Greg): open https://venue-os.app/super/bugs`);
  console.log(`Three bugs are now PROPOSED with full analyses. Click each one,`);
  console.log(`hit "Approve & Ship" — fires the BUG_FIX_SHIPPED email to`);
  console.log(`greg.schiemann@e-arc.com via Railway's RESEND_API_KEY.`);
  console.log();
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
