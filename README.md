**Still maintaining parsing algorithm!**

# Zotero Reference Linker

Reference Linker highlights bibliography entries whose papers are already in your Zotero library. Click a highlight to open its PDF or select the Zotero item.

Highlights are part of the reader UI. The plugin does not modify PDFs or create Zotero annotations.

<img src="./demo/demo.gif" alt="Demo" width="500">

## Install

1. Download the latest XPI from [GitHub Releases](https://github.com/ottersem/zotero-reference-linker/releases/latest).
2. In Zotero, open **Tools → Plugins**.
3. From the gear menu, choose **Install Plugin From File…**.
4. Select the XPI and restart Zotero.

Zotero 9 and 10 are supported.

## Use

Open a PDF. Reference Linker scans automatically as reader pages are rendered. Click **Ref ↗** to force a manual rescan; the button shows **Scanning…** while it runs and the result appears in the summary at the right edge of the reader.

- Yellow references are matched to your library. `↗ PDF` opens the saved PDF, while `↗ Item` selects an item without an attached PDF.
- Gray references are unmatched. Click one to open its DOI, search Google Scholar, or copy its title when that metadata is available.
- The scan summary reports scanned, matched, ambiguous, and unmatched reference counts.

If no links appear, scroll through the reference pages once. Zotero renders only nearby PDF pages, and Reference Linker rescans when newly rendered pages are detected.

## Matching

References are matched in this order:

1. DOI
2. arXiv ID
3. Bibliographic fingerprint for references without titles
4. Normalized title
5. Conservative fuzzy title match

A bibliographic fingerprint uses the first author, year, journal, volume, and first page or article number. Ambiguous or conflicting matches are left unlinked.

Numbered and author-year bibliographies are supported. Title matching ignores capitalization, punctuation, whitespace, diacritics, and line-break hyphenation.

## Supported reference styles

The plugin is not limited to specific journals. These formats have been tested:

- Astronomy: A&A, ApJ, ApJS, ARA&A, and MNRAS
- Physics: Ann. Phys., Physical Review Letters, Physics Letters B, JHEP, Reviews of Modern Physics, and Physics Reports
- Mathematics: numbered references with comma-delimited titles
- Biomedical: Vancouver-style references, including Genome Biology, Nature Biotechnology, and Nature Methods
- Computer science: IEEE, ACM, CVPR, ICML, ICLR, and NeurIPS styles

Other journals generally work when references contain a DOI, arXiv ID, title, or an unambiguous bibliographic fingerprint.

## TODO

- [x] Scan automatically when a PDF opens and when newly rendered pages are detected.
- [x] Show a scan summary with the numbers of references scanned, matched, ambiguous, and unmatched.
- [x] Add actions for unmatched references, including opening a DOI, searching Google Scholar, and copying the title.
- [ ] Optionally link matched papers through Zotero's Related Items, with an explicit bulk action and undo support.

## Development

Requires Node.js 20 or newer.

```bash
npm install
npm run verify
```

`npm run verify` runs type checking and tests, then creates the unpacked extension in `build/` and an installable XPI.

For a development install, create this proxy file in the active Zotero profile:

```text
extensions/zotero-reference-linker@ottersem.github.io
```

Set its contents to the absolute path of the `build` directory, then restart Zotero.

The unpacked extension is also available from npm:

```bash
npm install zotero-reference-linker
```

## Limitations

- Image-only PDFs require OCR.
- Complex PDF text layers may produce incorrect reading order.
- Matching depends on accurate citation and Zotero metadata.
- Reference pages must be rendered before links can be drawn.
- Zotero Reader internals may change between releases.

## Reporting a problem

Include the Zotero and plugin versions, citation style, one failed reference, and a public paper link when available.
