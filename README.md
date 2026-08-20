# Reference Linker for Zotero 9–10

Reference Linker scans the **rendered pages** of the References/Bibliography section in the open PDF, matches citations against items in the current Zotero library, and adds a non-destructive yellow Reader overlay. Clicking `↗ PDF` opens the matched PDF attachment; `↗ Item` selects the parent library item.

The PDF file and Zotero annotations are never modified.

## MVP matching

Matching is attempted in this order:

1. DOI exact match (normalized)
2. arXiv ID exact match (version suffix ignored)
3. Normalized title exact match, with year and first-author tie-breaking
4. Fuzzy title token similarity, adjusted by year and first author

## Requirements

- Zotero 9.x or Zotero 10.x (including current Zotero 10 beta builds)
- Node.js 20 or newer
- npm

## Build

```bash
npm install
npm run verify
```

Outputs:

- `build/` — unpacked plugin
- `zotero-reference-linker-0.2.1.xpi` — installable package

## Install

1. In Zotero, open **Tools → Plugins**.
2. Choose the gear menu, then **Install Plugin From File…**.
3. Select `zotero-reference-linker-0.2.1.xpi`.
4. Open a PDF and scroll to its References section so those pages are rendered.
5. Click **Ref ↗** in the Reader toolbar. The plugin also rescans after Reader pages render.

For source-based development, create a Zotero profile `extensions/reference-linker@local.invalid` text file containing the absolute path to the `build/` directory, then restart Zotero. See Zotero's plugin-development documentation for profile details.

## Architecture

- `bootstrap.js` — Zotero lifecycle entry point; loads the bundled script
- `src/index.ts` — plugin entry point
- `ReaderIntegration` — toolbar registration, Reader lifecycle, rescanning, navigation
- `ReferenceExtractor` — finds the References heading in PDF.js text layers and groups numbered or author-year entries
- `CitationParser` — parses DOI, arXiv ID, title, year, and first author
- `LibraryMatcher` — indexes the current library and performs exact/fuzzy matching
- `ReferenceOverlay` — paints transient highlights and clickable badges in the Reader DOM

## Known MVP limits

- Zotero/PDF.js virtualizes pages. The References pages must have been rendered (usually by scrolling to them) before scanning.
- Multi-column reading order depends on the PDF text layer. Complex layouts, scanned/image-only PDFs, and references split unusually across columns may need OCR or a layout-aware parser.
- Citation title extraction is heuristic. DOI/arXiv matches are the most reliable.
- The Reader DOM is an internal surface even though Reader event registration is public. Zotero 9/10 point releases may require selector adjustments.

## Zotero 10 compatibility

Version 0.2.1 extends the manifest compatibility range through Zotero 10 (`strict_max_version: 10.99.99`). The explicit numeric upper bound also accepts Zotero 10 development builds whose version contains an underscore and build identifier (for example `10.0_20260817111755`), which may compare above `10.*`. The plugin only reads the in-process Zotero item API and uses the existing public Reader event registration API; it does not use Zotero 10's new authenticated local-API write support.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The XPI is a ZIP archive with `manifest.json` and `bootstrap.js` at its root.
# zotero-reference-linker
