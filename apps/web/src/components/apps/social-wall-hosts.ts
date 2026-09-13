/**
 * Social-wall aggregator hosts — the ONE list the Social Wall app checks a
 * pasted link against.
 *
 * Deliberately mirrors `components/widgets/streaming-hosts.ts` (exported
 * const tuple + a dot-boundary `isAllowed…Host`), for the same reason that
 * file exists: a widget that frames a third-party URL needs exactly one
 * place that says which third parties, or the next caller drifts.
 *
 * WHY AN ALLOWLIST AND NOT "ANY URL". A moderated multi-network wall is a
 * PRODUCT an operator buys (Walls.io, Juicer, Taggbox). VenueOS's honest job
 * is to put THAT wall on the screen — so the app's promise is "your wall,
 * on the glass", and a link that is not one of those walls has to be refused
 * in the operator's language rather than framed and hoped for. The generic
 * "Web Page / URL" app is the right home for any other link, and it is one
 * tile away.
 *
 * VERIFIED 2026-09-12 against each vendor's own docs (quoted in the commit
 * message and in `url-transforms.toSocialWallEmbedUrl`):
 *   - Walls.io   https://my.walls.io/<wallId>            (help.walls.io 9095096)
 *   - Juicer     https://www.juicer.io/api/feeds/<feed>/iframe
 *                                                        (help.juicer.io 12702153)
 *   - Taggbox    https://app.taggbox.com/widget/e/<id>   (taggbox.com blog, verbatim iframe)
 *
 * NOT HERE, ON PURPOSE:
 *   - `widget.taggbox.com` — checked live on 2026-09-12: it 301-redirects to
 *     `https://taggbox.com/`, i.e. it is NOT an embed host. Allowing it would
 *     frame a marketing redirect.
 *   - `walls.io` (the bare apex) — that is the marketing site
 *     (`walls.io/pricing`, `walls.io/solutions/...`). Only `my.walls.io`
 *     serves a wall.
 *   - Curator.io — script-only, see SCRIPT_ONLY_WALL_HOSTS below.
 *   - EmbedSocial / Flockler — both are plausibly iframe-capable, but neither
 *     publishes a quotable iframe `src` outside a logged-in dashboard, so
 *     they stay out until someone can verify one. Guessing a URL shape here
 *     produces a blank screen, which is the defect class this app exists to
 *     stop being.
 */
export const SOCIAL_WALL_HOSTS = [
  'my.walls.io',
  'juicer.io',
  'app.taggbox.com',
] as const;

/** True when `host` is an allowlisted wall host or a subdomain of one. */
export function isSocialWallHost(host: string): boolean {
  const h = (host || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if (!h) return false;
  for (const allowed of SOCIAL_WALL_HOSTS) {
    // Exact host, or a dot-boundary suffix — so `my.walls.io.evil.com` and
    // `notjuicer.io` are both refused (same rule as isAllowedStreamingHost).
    if (h === allowed || h.endsWith('.' + allowed)) return true;
  }
  return false;
}

/**
 * Aggregators whose ONLY embed is a `<script>` tag. A screen cannot run one:
 * the WEBPAGE widget frames a URL through the proxy — it does not host a
 * third-party script on our own page, and it never will (that script would
 * execute same-origin with the dashboard).
 *
 * Curator.io says so itself, on its own features page: "We use Javascript
 * rather than IFRAMEs like most other aggregators so Google can crawl your
 * content." (https://curator.io/features, read 2026-09-12.)
 *
 * Recognising these is worth a few lines because the alternative is telling
 * an operator with a perfectly good Curator wall that their link "doesn't
 * look like a wall link" — true, useless, and it sends them round the loop
 * again. Nothing here ever ALLOWS anything; it only picks a better sentence.
 */
export const SCRIPT_ONLY_WALL_HOSTS = ['curator.io'] as const;

/** Plain-English refusal for a script-only aggregator, or null. */
export function scriptOnlyWallReason(input: string): string | null {
  const raw = (input || '').toLowerCase();
  if (!raw) return null;
  for (const host of SCRIPT_ONLY_WALL_HOSTS) {
    // Host-ish boundary on both sides: `cdn.curator.io/published/x.js` and
    // `https://curator.io/` match; `curator.io.evil.com` does NOT (the
    // trailing `.` fails the lookahead), so a lookalike falls through to the
    // ordinary "that doesn't look like a wall link" refusal.
    const re = new RegExp(
      `(?:^|[^a-z0-9.-])(?:[a-z0-9-]+\\.)*${host.replace(/\./g, '\\.')}(?![a-z0-9.-])`,
    );
    if (re.test(raw)) {
      return 'Curator.io only offers a script embed, which screens can’t run — use its published page URL if it has one, or Walls.io/Juicer/Taggbox.';
    }
  }
  return null;
}
