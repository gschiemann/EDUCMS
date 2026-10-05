# PDF pages fixtures (2026-10-05)

Tiny PDFs for the "PDF pages on screens" suites (`proxy/pdf-raster-pipeline.spec.ts`,
`storage/pdf-pages/*`). Made with reportlab 5.0.1 (standard Helvetica — no embedded
font, so each file is ~2 KB) and encrypted with pypdf 6.19.0:

- `three-pages.pdf` — page 1 US Letter portrait (red band on top), page 2 a 960×540 pt
  16:9 slide (green band), page 3 US Letter with `/Rotate 90` (blue band).
- `owner-only-<algo>.pdf` — one page, owner password `owner-secret`, EMPTY user
  password: anyone can open it, so it must render.
- `user-password-<algo>.pdf` — one page, user password `user-secret`: nobody can
  open it without the password, so it must be refused.
- `<algo>` ∈ rc4-40, rc4-128, aes-128, aes-256-r5 (the deprecated Adobe extension
  level 3), aes-256 (PDF 2.0, R6).

Regenerate: `pip install reportlab pypdf cryptography`, then the generator kept in
`docs/research/2026-10-05-pdf-pages/` (the report), section "Fixtures".
