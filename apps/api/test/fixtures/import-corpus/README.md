# Import golden corpus

The documents every import test runs against, in one place, because four suites
were reading two byte-identical copies and a corpus that exists twice drifts.

Add a fixture here when it proves something a real operator's file does, and say
what that is in the table. A fixture nobody can explain is a fixture nobody will
maintain.

| file | pages | what it proves |
|---|---|---|
| `mixed-layout.pdf` | 3 | Page 1: a dark background, a white heading, two **separately positioned columns** and a colour block — the columns catch text runs being merged into one zone, and the background catches "imports as white on white". Page 2: **artwork only, no text** — the page the text-only importer silently dropped, and the one a rasterizer must still return. Page 3: text only. |
| `forty-one-pages.pdf` | 41 | One page past the 40-page cap the PDF parser used to apply silently. Proves truncation is reported rather than hidden, and gives the rasterizer a realistic multi-page timing case. |

Both are synthetic and contain no customer data. They were generated for the
2026-09-15 template-import audit; `docs/design/proposals/2026-09-15-template-import-audit/evidence/`
holds a frozen copy as part of that audit's record, which nothing executable
reads — **this** directory is the live corpus.

Still missing, and worth adding before import ships: a scanned (image-only) PDF,
a rotated page, a cropped page, a password-protected file, a malformed file, and
real exported decks from PowerPoint, Google Slides and Canva with master
placeholders, grouped shapes, interleaved images and text, tables and charts.
