# Bottle Service saved verification at shutdown

Source `9d712abb`, unaccepted and not integrated. Agent was interrupted after its pause-progress message to honor immediate shutdown. All source, raw results, harnesses and screenshots are preserved; no continuing agent or test was left running. The following table is derived from the already-completed saved run, not a new test.

| Engine | Orientation | Copy/style | Page errors | Field collision pairs | Containment findings | Font-floor violations |
|---|---|---|---:|---:|---:|---:|
| chromium | landscape | default | 0 | 0 | 7 | 0 |
| chromium | landscape | long | 0 | 2 | 7 | 0 |
| chromium | landscape | manual | 0 | 0 | 7 | 0 |
| chromium | portrait | default | 0 | 0 | 7 | 0 |
| chromium | portrait | long | 0 | 0 | 7 | 0 |
| chromium | portrait | manual | 0 | 0 | 7 | 0 |
| webkit | landscape | default | 0 | 0 | 7 | 0 |
| webkit | landscape | long | 0 | 2 | 7 | 0 |
| webkit | landscape | manual | 0 | 0 | 7 | 0 |
| webkit | portrait | default | 0 | 0 | 7 | 0 |
| webkit | portrait | long | 0 | 0 | 7 | 0 |
| webkit | portrait | manual | 0 | 0 | 7 | 0 |

Next correction: landscape longer `b.0.d` intersects `b.0.p` and `b.0.svc` in both engines. Header/footer field Range bounds extend beyond their owners by approximately5–11px; portrait table-name bounds extend approximately4.8px. Classify against actual screenshots and reserve adequate room rather than lowering font floors or ignoring overlap. All76 visible fields remain. Default and explicit-font collision checks passed but containment means the source is not accepted.

Full raw results: `bottle-shutdown-results.json`. Harnesses and screenshots: Desktop/template-flagship-audit/shutdown-2026-10-13/astra-source-evidence.
