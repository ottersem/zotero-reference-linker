# Zotero Reference Linker

> Automatically highlight references that already exist in your Zotero library and open the linked paper or PDF with one click.

![Zotero](https://img.shields.io/badge/Zotero-9%20%7C%2010-CC2936?logo=zotero&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Version](https://img.shields.io/badge/version-0.8.1-blue)

## Overview

Zotero Reference Linker scans the **References**, **Bibliography**, or **Works Cited** section of the PDF currently open in Zotero Reader. It compares each citation with papers stored in the active Zotero library and adds a temporary yellow overlay to matching references.

- Click `↗ PDF` to open the matched PDF attachment.
- Click `↗ Item` to select the matched Zotero item.
- Click highlighted reference text to open it directly.
- The original PDF and Zotero annotations are never modified.

## Features

- Automatic References-section detection using Zotero's PDF structure
- Full-document heading scan when structured section data is unavailable
- Numbered references such as `[12]` or `12.`
- Unnumbered author–year bibliographies used by AAAI, ICML, and similar venues
- Multi-column PDF text layers
- Line-end hyphenation such as `seg- mentation`
- DOI and arXiv ID exact matching
- Normalized title exact and fuzzy matching
- Clickable, non-destructive Reader overlays
- Cached library and rendered-page indexes for efficient rescanning
- Zotero 9 and Zotero 10 support

## Installation

1. Download `zotero-reference-linker-0.8.1.xpi`.
2. Open Zotero.
3. Go to **Tools → Plugins**.
4. Open the gear menu and select **Install Plugin From File…**.
5. Select the downloaded XPI file.
6. Restart Zotero.

## Usage

1. Open a PDF in Zotero Reader.
2. Navigate to the References or Bibliography pages.
3. Click **Ref ↗** in the Reader toolbar.
4. Click a yellow highlight, `↗ PDF`, or `↗ Item` to open the matched entry.

The toolbar briefly displays the number of links actually rendered on the currently loaded reference pages.

> [!NOTE]
> Zotero virtualizes PDF pages. Reference pages must be visible or recently rendered before their overlays can appear.

## Matching Strategy

Matches are evaluated in the following order:

1. Normalized DOI exact match
2. Normalized arXiv ID exact match
3. Normalized title exact match
4. Fuzzy title similarity with year and first-author scoring

For unnumbered bibliographies, indexed Zotero titles are compared directly with the rendered References text. PDF punctuation, capitalization, whitespace, Unicode variants, and line-end hyphenation are normalized before comparison.

## Requirements

### Runtime

- Zotero 9.x or 10.x
- A text-based PDF

### Development

- Node.js 20 or newer
- npm

## Build from Source

```bash
npm install
npm run verify
```

Generated files:

```text
build/                                  Unpacked plugin
zotero-reference-linker-0.8.1.xpi      Installable Zotero plugin
```

Available commands:

```bash
npm run typecheck   # Run TypeScript validation
npm test            # Run the test suite
npm run build       # Build and package the XPI
npm run verify      # Typecheck, test, and build
npm run clean       # Remove the unpacked build directory
```

## Project Structure

```text
zotero-reference-linker/
├── bootstrap.js                 Zotero lifecycle bootstrap
├── manifest.json                Zotero extension manifest
├── scripts/
│   ├── build.mjs                Bundle and XPI packaging
│   └── clean.mjs                Build cleanup
├── src/
│   ├── index.ts                 Plugin entry point
│   ├── core/
│   │   ├── CitationParser.ts    Citation metadata extraction
│   │   ├── LibraryMatcher.ts    Library index and matching
│   │   ├── PdfSectionExtractor.ts
│   │   ├── normalize.ts
│   │   └── types.ts
│   └── reader/
│       ├── ReaderIntegration.ts Reader lifecycle and scanning
│       └── ReferenceOverlay.ts  Highlights and navigation
└── test/                        Vitest test suite
```

## How It Works

```text
Open Zotero PDF
       ↓
Detect References section
       ↓
Extract numbered citations and rendered text
       ↓
Compare DOI, arXiv ID, and normalized titles
       ↓
Render temporary highlights and link badges
       ↓
Open the matched Zotero item or PDF
```

## Privacy and Data Safety

- All matching runs locally inside Zotero.
- The plugin does not upload PDFs, citations, or library metadata.
- The original PDF is not edited.
- No permanent Zotero annotations are created.

## Known Limitations

- Scanned or image-only PDFs require OCR before text can be detected.
- Unusual text-layer ordering may affect complex multi-column layouts.
- References split across non-contiguous pages may require those pages to be rendered.
- Zotero Reader DOM selectors are internal and may require updates after future Zotero releases.

## Development Installation

Build the project, then create a text file named:

```text
extensions/reference-linker@local.invalid
```

Place the absolute path to the generated `build/` directory inside that file and restart Zotero. The file must be created inside the active Zotero profile directory.

## Contributing

Bug reports and pull requests are welcome. When reporting a PDF-specific issue, include:

- Zotero version
- Plugin version
- Citation style or venue
- Whether the PDF is text-based or scanned
- A minimal example of the reference that failed

Before submitting code, run:

```bash
npm run verify
```
