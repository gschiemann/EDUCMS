# Decision - picomatch GHSA-fc5q-39xc-vjpf has no fixed version: a 30-day waiver with a proof, or a red gate

Article 12 (independent security review), Article 54 (supplier compromise) · written 2026-11-17 by the lead during the patch sweep of that day (`docs/handoffs/2026-11-17-patch-sweep.md`) · **decision requested from the owner: this changes what a CI gate accepts.**

**Situation.** GHSA-fc5q-39xc-vjpf (CVE-2026-112366, high) says picomatch compiles a glob pattern such as `+(*)` or `+(*a)` into a regular expression that backtracks exponentially, so whoever supplies the pattern can block the event loop. It was published on 2026-10-19 and widened on 2026-11-17 to `<= 4.0.7`, which is the newest release. There is no fixed version, so no override can pin one. From that hour `Production Dependency Audit` fails on every pull request and `Security Watch` fails every hour on `master`. Neither is a required check, but a gate that is always red stops telling anyone anything: the next real advisory would arrive on a job nobody looks at.

**Evidence.**

| Question | Answer | How it was read |
|---|---|---|
| Which production closures hold picomatch? | `web` only (4.0.4). Not `api`, not `renderer` | `pnpm ls -r --prod --depth Infinity --json`, the gate's own enumerator |
| What brings it in? | `@sentry/nextjs` -> `@rollup/plugin-commonjs` -> (`@rollup/pluginutils`, `fdir`, picomatch); `next-intl` -> `@parcel/watcher` -> picomatch | the same tree |
| When do those run? | `@sentry/nextjs` loads the rollup plugin only in `config/loaders/wrappingLoader.js`, a webpack loader that runs at build time. `next-intl` loads the watcher in its plugin and in `extractor/source/SourceFileWatcher`, which watches source files | `grep` of the two installed packages |
| Who supplies their glob patterns? | Plugin configuration in this repository. No request reaches them | follows from the row above |
| Does our own code use a glob matcher? | No: 0 imports of picomatch, micromatch, anymatch, minimatch, fast-glob, tinyglobby, glob, globby or chokidar in 1,912 first-party source files | `scripts/check-picomatch-unreachable.cjs` |
| Is a fix coming? | An upstream pull request exists (micromatch/picomatch 254); nothing is released | the advisory page and that pull request, 2026-11-17 |

**Recommendation.** Accept this one advisory for 30 days, through the mechanism the gate already has for exactly this case (`WAIVERS` in `scripts/npm-advisory-audit.cjs`: no fixed version, a named unreachable path, a proof re-derived on every run, a mandatory expiry).

- One entry: `picomatch`, `ghsa: GHSA-fc5q-39xc-vjpf`, `expires: 2026-12-17`.
- Its proof, `scripts/check-picomatch-unreachable.cjs`, re-derives three claims against the installed tree on every run: only `web` holds it; it arrives only under the two reviewed packages and four reviewed direct parents; no first-party file imports a glob matcher. A new parent, a new importer or a first-party import turns the waiver off and the gate red.
- The gate becomes stricter in one way: a waiver that names its advisory now covers that advisory only. Before this change a waiver matched on the package name alone, so it would also have covered a second, different advisory on the same package.
- The waived finding is still printed, with its proof, on every run.

**Risk.** A waiver is an accepted risk, not a fix. What it rests on is that the two parents use picomatch only on patterns from configuration; the proof pins which packages may bring it in, it does not read their source on every run. If one of them started compiling a pattern taken from a request, the proof would not notice. The development graph holds more copies (jest, vitest, eslint tooling); the gate has never audited that graph.

**Validation.** `node --test scripts/__tests__/*.test.cjs`: 127 pass, including the new waiver rules and the proof's import detector with look-alike controls. `node scripts/npm-advisory-audit.cjs`: exit 0, prints `WAIVED (1)` with the proof's three lines. Broken on purpose three ways (an unreviewed parent, an unreviewed importer, a first-party `import picomatch`): each makes the proof fail and the gate exit 1 with "its unreachability PROOF no longer holds".

**Rollback.** Revert the pull request: the gate is red again, exactly as today.

**What ends it.** A picomatch release that fixes the advisory: pin it in `pnpm.overrides`, delete the entry and the proof. Or 2026-12-17, when the waiver stops applying by itself and someone has to look again.

**Decision.** Pending the owner's written go. Until then the two jobs stay red on this one finding.

Models: Claude Fable 5.2 (`claude-fable-5-2`), Claude Code cloud session.
