# Constellations — Paper Draft (Index)

This directory is a living draft in Markdown. Start with the outline, then iterate section-by-section.

## Draft sections
- [00-outline.md](./00-outline.md) — working outline + contributions
- [01-abstract.md](./01-abstract.md)
- [02-introduction.md](./02-introduction.md)
- [03-related-work.md](./03-related-work.md)
- [04-system.md](./04-system.md)
- [06-discussion-future-work.md](./06-discussion-future-work.md)

## References
- [bibliography.html](../bibliography.html)

## Notes
- Prefer editing these `.md` files directly in Cursor.
- `index.html` still exists for browsing in a normal web browser at `/paper/index.html`.

## Build (HTML + PDF)
- Render HTML: `npm run render:paper`
- Render HTML + export PDF (uses headless Google Chrome): `npm run render:paper:pdf`

## Build (TeX PDF, 2-column)
- Generate LaTeX from the Markdown draft: `npm run render:paper:tex`
- Generate LaTeX + compile PDF (TeX 2-column): `npm run render:paper:tex:pdf`
- Output: `public/paper/rendered/paper.pdf`