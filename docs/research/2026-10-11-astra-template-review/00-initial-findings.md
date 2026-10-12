# Astra review — initial verified findings

Received 2026-10-11 from the explicitly requested gpt-6-astra reviewer.

Current gallery posters still show landscape row/secondary-text collisions in `school/elem-schedule-v1.html` and `v3.html`: room/teacher lines meet or pass through row boundaries; v1 also clips the attendance caption at the right. The reviewer confirmed these in current `_thumbs` rather than old evidence.

The strongest visual work is fashion editorial/trunkshow and the bold operational queue/pickup layouts. Many corporate, healthcare, hospitality and bar boards repeat cream backgrounds, thin rules and small supporting copy. They are polished and usable, but not consistently distinctive or world-class.

The reviewer is validating a bounded three-to-five-item patch recommendation and full coverage report. These findings are preserved before reporting them to the user; no design-quality pass has been inferred from test results.

Second message: Care Services portrait has an avoidably poor default photo crop (doctor cut at the mouth, foreground person's head dominant), verified in `clinic-service-gap/default/chromium-portrait.png` and the final gallery. Recommendation: orientation-specific authored focal position immediately; shared Crop/Reposition UX separately.

Sports evidence covers all 24 variants in both orientations. Headline contrast is clearer, but accent red/green/purple supporting text remains weak and scenes retain thin generic type. Portrait evidence is letterboxed; that limitation is harness-dependent and is not asserted as a production regression. Current QSR and veterinary posters fix the defects visible in earlier screenshots, so those old problems are not reported as current defects.
