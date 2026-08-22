import { surname } from "./normalize";
import type { ReferenceBlock, ReferenceSection } from "./types";

interface PdfTextItem { str?: string; hasEOL?: boolean; transform?: ArrayLike<number> }
interface PdfPage { getTextContent(): Promise<{ items: PdfTextItem[] }> }
interface OutlineItem {
  title?: string;
  items?: OutlineItem[];
  location?: { position?: { pageIndex?: number } };
}
export interface PdfDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getOutline2?(): Promise<OutlineItem[] | null>;
}

const REFERENCE_HEADING = /^\s*(?:\d{1,4}\s+)?(references|bibliography|works cited|literature cited|references cited)(?:\s+\d{1,4})?\s*$/i;
const STOP_HEADING = /^\s*(?:\d{1,4}\s+)?(appendix|appendices|supplementary material|supplemental material|acknowledg(?:e)?ments?)(?:\s+\d{1,4})?\b/i;
const LETTERED_STOP_HEADING = /^\s*A(?:\.\d+)?(?:\.\s*|\s+)(?=[\p{Lu}])[^,.;]{2,100}\s*$/u;
const LABELED_START = /(?:^|\n)\s*(?:\[\s*((?=[^\]\n]{0,24}\d)[A-Za-z0-9][A-Za-z0-9+.:/_\-\s]{0,23})\s*\]|((?!(?:18|19|20|21)\d{2}\b)\d{1,4})[.)])\s+/g;
const PARTICLE = `(?:[Dd]e|[Dd]el|[Dd]en|[Dd]er|[Dd]i|[Dd]u|[Ll]a|[Ll]e|[Vv]an|[Vv]on)\\s+`;
const SURNAME = `(?:${PARTICLE}){0,3}[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+(?:\\s+[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+){0,2}`;
const INITIALS = `(?:[A-Z](?:\\.-[A-Z])?\\.(?:\\s*[A-Z](?:\\.-[A-Z])?\\.){0,5}|[A-Z](?:-[A-Z])?(?=\\s*[,;]))`;
const AUTHOR_START = new RegExp(`(?:^|\\n)(?=\\s*${SURNAME},\\s*${INITIALS})`, "gu");
const ORGANIZATION_START = /(?:^|\n)(?=\s*[A-Z][^\n,]{1,80}\b(?:Collaboration|Partnership)\b[^\n]*\b(?:19|20)\d{2}[a-z]?\b)/gu;
const DITTO_START = /(?:^|\n)(?=\s*[—–-]\.\s*(?:19|20)\d{2}[a-z]?\b)/gu;
const DISCRETIONARY_HYPHEN = /[-\u00ad\u0002]\s*$/;
const CONTINUATION_LINE = "\u0001";
const PDF_DIACRITIC_ARTIFACT = /[´`^¨]\s*/g;

export class PdfSectionExtractor {
  async extract(pdf: PdfDocument): Promise<ReferenceSection | undefined> {
    const structured = await this.fromOutline(pdf);
    if (structured) {
      const section = await this.extractRange(pdf, structured.startPage, structured.endPage, "zotero-structure", undefined, undefined, structured.startHeading, structured.endHeading);
      section.startHeading = structured.startHeading;
      section.endHeading = structured.endHeading;
      return section;
    }
    const scanned = await this.findByHeadings(pdf);
    if (!scanned) return undefined;
    const section = await this.extractRange(pdf, scanned.startPage, scanned.endPage, "heading-scan", scanned.startLine, scanned.endLine);
    section.startHeading = "References";
    return section;
  }

  private async fromOutline(pdf: PdfDocument): Promise<{ startPage: number; endPage: number; startHeading: string; endHeading?: string } | undefined> {
    if (!pdf.getOutline2) return undefined;
    try {
      const outline = await pdf.getOutline2();
      const flat = this.flatten(outline || []);
      const refIndex = flat.findIndex(entry => REFERENCE_HEADING.test(entry.title));
      if (refIndex < 0) return undefined;
      const ref = flat[refIndex]!;
      const next = flat.slice(refIndex + 1).find(entry => entry.depth <= ref.depth && entry.page > ref.page);
      return { startPage: ref.page, endPage: next ? next.page : pdf.numPages - 1, startHeading: ref.title, endHeading: next?.title };
    } catch {
      return undefined;
    }
  }

  private flatten(items: OutlineItem[], depth = 0): Array<{ title: string; page: number; depth: number }> {
    const result: Array<{ title: string; page: number; depth: number }> = [];
    for (const item of items) {
      const page = item.location?.position?.pageIndex;
      if (item.title && page != null) result.push({ title: item.title.trim(), page, depth });
      result.push(...this.flatten(item.items || [], depth + 1));
    }
    return result;
  }

  private async findByHeadings(pdf: PdfDocument): Promise<{ startPage: number; endPage: number; startLine: number; endLine?: number } | undefined> {
    let found: { startPage: number; startLine: number } | undefined;
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const lines = await this.pageLines(pdf, pageIndex);
      if (!found) {
        const startLine = lines.findIndex(line => REFERENCE_HEADING.test(this.visibleLine(line)));
        if (startLine >= 0) found = { startPage: pageIndex, startLine: startLine + 1 };
        continue;
      }
      const stopLine = lines.findIndex(line => this.isStopHeading(line));
      if (stopLine >= 0) return { ...found, endPage: pageIndex, endLine: stopLine };
    }
    return found ? { ...found, endPage: pdf.numPages - 1 } : undefined;
  }

  private async extractRange(
    pdf: PdfDocument,
    startPage: number,
    endPage: number,
    source: ReferenceSection["source"],
    startLine = 0,
    endLine?: number,
    startHeading?: string,
    endHeading?: string
  ): Promise<ReferenceSection> {
    const pages: string[] = [];
    let detectedEndPage = endPage;
    for (let pageIndex = startPage; pageIndex <= endPage; pageIndex++) {
      let lines = await this.pageLines(pdf, pageIndex);
      if (pageIndex === startPage && startHeading) {
        const headingLine = lines.findIndex(line => this.sameHeading(line, startHeading));
        if (headingLine >= 0) startLine = headingLine + 1;
      }
      if (pageIndex === endPage && endHeading) {
        const headingLine = lines.findIndex(line => this.sameHeading(line, endHeading));
        if (headingLine >= 0) endLine = headingLine;
      }
      if (pageIndex === startPage) lines = lines.slice(startLine);
      if (pageIndex === endPage && endLine != null) lines = lines.slice(0, endLine);
      const stopLine = lines.findIndex(line => this.isStopHeading(line));
      if (stopLine >= 0) {
        lines = lines.slice(0, stopLine);
        detectedEndPage = pageIndex;
        if (lines.length) pages.push(lines.join("\n"));
        break;
      }
      pages.push(lines.join("\n"));
    }
    return { startPage, endPage: detectedEndPage, references: this.splitReferences(pages.join("\n")), source };
  }

  private sameHeading(a: string, b: string): boolean {
    const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    return normalize(a) === normalize(b);
  }

  private isStopHeading(line: string): boolean {
    const visible = this.visibleLine(line);
    return STOP_HEADING.test(visible) || LETTERED_STOP_HEADING.test(visible);
  }

  private visibleLine(line: string): string {
    return line.replaceAll(CONTINUATION_LINE, "");
  }

  private async pageLines(pdf: PdfDocument, pageIndex: number): Promise<string[]> {
    const wrappedPage = await pdf.getPage(pageIndex + 1);
    const page = this.unwrap(wrappedPage);
    if (typeof page.getTextContent !== "function") {
      throw new Error(`Reference Linker: PDF page ${pageIndex + 1} does not expose getTextContent()`);
    }
    const content = await page.getTextContent();
    const lines: Array<{ text: string; x?: number; y?: number; order: number }> = [];
    let line = "";
    let lineX: number | undefined;
    let lineY: number | undefined;
    let continued = "";
    let continuedX: number | undefined;
    let continuedY: number | undefined;
    for (const item of content.items) {
      if (item.str) {
        if (!line) {
          lineX = typeof item.transform?.[4] === "number" ? item.transform[4] : undefined;
          lineY = typeof item.transform?.[5] === "number" ? item.transform[5] : undefined;
        }
        line += (line && !/[-–—\s]$/.test(line) ? " " : "") + item.str;
      }
      if (item.hasEOL) {
        const value = line.trim();
        if (DISCRETIONARY_HYPHEN.test(value)) {
          if (!continued) {
            continuedX = lineX;
            continuedY = lineY;
          }
          continued += value.replace(DISCRETIONARY_HYPHEN, "");
        } else if (value) {
          lines.push({ text: `${continued}${value}`.replace(PDF_DIACRITIC_ARTIFACT, "").trim(), x: continuedX ?? lineX, y: continuedY ?? lineY, order: lines.length });
          continued = "";
          continuedX = undefined;
          continuedY = undefined;
        }
        line = "";
        lineX = undefined;
        lineY = undefined;
      }
    }
    if (line.trim() || continued) lines.push({ text: `${continued}${line.trim()}`.replace(PDF_DIACRITIC_ARTIFACT, "").trim(), x: continuedX ?? lineX, y: continuedY ?? lineY, order: lines.length });
    const positionCounts = new Map<number, number>();
    for (const value of lines) {
      if (value.x == null) continue;
      const position = Math.round(value.x);
      positionCounts.set(position, (positionCounts.get(position) || 0) + 1);
    }
    const recurringPositions = [...positionCounts]
      .filter(([, count]) => count >= 2)
      .map(([position]) => position);
    const numberedLines = lines.map(value => Number(value.text.match(/\s(\d{1,4})$/)?.[1] || NaN));
    let sequentialRun = 0;
    let longestSequentialRun = 0;
    for (let i = 1; i < numberedLines.length; i++) {
      sequentialRun = Number.isFinite(numberedLines[i - 1]) && numberedLines[i] === numberedLines[i - 1]! + 1 ? sequentialRun + 1 : 0;
      longestSequentialRun = Math.max(longestSequentialRun, sequentialRun);
    }
    if (longestSequentialRun >= 3) {
      for (const value of lines) value.text = value.text.replace(/\s+\d{1,4}$/, "");
    }
    const columnBases = recurringPositions
      .sort((a, b) => a - b)
      .filter(position => !recurringPositions.some(other => position - other >= 5 && position - other <= 24));
    const hasColumns = columnBases.length >= 2 && columnBases.at(-1)! - columnBases[0]! >= 100;
    const ordered = hasColumns ? [...lines].sort((a, b) => {
      const column = (value: typeof a) => {
        if (REFERENCE_HEADING.test(value.text)) return 0;
        if (value.x == null) return 0;
        let best = 0;
        for (let i = 1; i < columnBases.length; i++) {
          if (Math.abs(value.x - columnBases[i]!) < Math.abs(value.x - columnBases[best]!)) best = i;
        }
        return best;
      };
      const columnDifference = column(a) - column(b);
      if (columnDifference) return columnDifference;
      if (a.y != null && b.y != null && Math.abs(a.y - b.y) > 0.5) return b.y - a.y;
      return a.order - b.order;
    }) : lines;
    return ordered.map(value => {
      if (value.x == null) return value.text;
      const indented = columnBases.some(position => value.x! - position >= 5 && value.x! - position <= 24);
      const labeled = /^\s*(?:\[\s*[A-Za-z0-9][^\]]{0,24}\]|\d{1,4}[.)])\s+/.test(value.text);
      return indented && !labeled ? `${CONTINUATION_LINE}${value.text}` : value.text;
    });
  }

  private unwrap<T>(value: T): T {
    const privileged = globalThis as typeof globalThis & {
      Cu?: { waiveXrays?<V>(target: V): V };
    };
    const withWrapper = value as T & { wrappedJSObject?: T };
    return privileged.Cu?.waiveXrays?.(value) || withWrapper.wrappedJSObject || value;
  }

  private splitReferences(text: string): ReferenceBlock[] {
    const starts = [...text.matchAll(LABELED_START)];
    if (starts.length >= 2) {
      return starts.map((match, i) => ({
        raw: this.visibleLine(text.slice(match.index!, starts[i + 1]?.index ?? text.length)).trim(),
        fragments: [],
        index: /^\d+$/.test(match[1] || match[2] || "") ? Number(match[1] || match[2]) : undefined
      })).filter(block => block.raw.length >= 20);
    }
    const indices = [...new Set([
      ...[...text.matchAll(AUTHOR_START)].map(match => match.index!),
      ...[...text.matchAll(ORGANIZATION_START)].map(match => match.index!),
      ...[...text.matchAll(DITTO_START)].map(match => match.index!)
    ])].sort((a, b) => a - b);
    let previousAuthor: string | undefined;
    return indices.map((start, i) => {
      const raw = this.visibleLine(text.slice(start, indices[i + 1] ?? text.length)).trim();
      const author = raw.match(new RegExp(`^(${SURNAME}),`, "u"))?.[1];
      const organization = raw.match(/^([^,]{1,80}\b(?:Collaboration|Partnership)\b)/i)?.[1];
      const firstAuthorHint = /^[—–-]\./.test(raw) ? previousAuthor : surname(author || organization);
      if (firstAuthorHint) previousAuthor = firstAuthorHint;
      return { raw, fragments: [], firstAuthorHint };
    }).filter(block => block.raw.length >= 20);
  }
}
