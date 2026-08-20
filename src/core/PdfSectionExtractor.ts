import type { ReferenceBlock, ReferenceSection } from "./types";

interface PdfTextItem { str?: string; hasEOL?: boolean }
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

const REFERENCE_HEADING = /^\s*(references|bibliography|works cited|literature cited|references cited)\s*$/i;
const STOP_HEADING = /^\s*(appendix|appendices|supplementary material|supplemental material|acknowledg(?:e)?ments?)\b/i;
const NUMBERED_START = /(?:^|\n)\s*(?:\[\s*(\d{1,4})\s*\]|(\d{1,4})[.)])\s+/g;
const AUTHOR_START = /(?:^|\n)(?=\s*(?:(?:de|del|den|der|di|du|la|le|van|von)\s+)?[A-ZÀ-ÖØ-Þ][\p{L}'’-]+,\s*(?:[A-Z](?:[-.\s]|$)){1,4})/gu;

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
        const startLine = lines.findIndex(line => REFERENCE_HEADING.test(line));
        if (startLine >= 0) found = { startPage: pageIndex, startLine: startLine + 1 };
        continue;
      }
      const stopLine = lines.findIndex(line => STOP_HEADING.test(line));
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
      const stopLine = lines.findIndex(line => STOP_HEADING.test(line));
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

  private async pageLines(pdf: PdfDocument, pageIndex: number): Promise<string[]> {
    const wrappedPage = await pdf.getPage(pageIndex + 1);
    const page = this.unwrap(wrappedPage);
    if (typeof page.getTextContent !== "function") {
      throw new Error(`Reference Linker: PDF page ${pageIndex + 1} does not expose getTextContent()`);
    }
    const content = await page.getTextContent();
    const lines: string[] = [];
    let line = "";
    for (const item of content.items) {
      if (item.str) line += (line && !/[-–—\s]$/.test(line) ? " " : "") + item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.replace(/-\s*$/, "").trim());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trim());
    return lines;
  }

  private unwrap<T>(value: T): T {
    const privileged = globalThis as typeof globalThis & {
      Cu?: { waiveXrays?<V>(target: V): V };
    };
    const withWrapper = value as T & { wrappedJSObject?: T };
    return privileged.Cu?.waiveXrays?.(value) || withWrapper.wrappedJSObject || value;
  }

  private splitReferences(text: string): ReferenceBlock[] {
    const starts = [...text.matchAll(NUMBERED_START)];
    if (starts.length >= 2) {
      return starts.map((match, i) => ({
        raw: text.slice(match.index!, starts[i + 1]?.index ?? text.length).trim(),
        fragments: [],
        index: Number(match[1] || match[2])
      })).filter(block => block.raw.length >= 20);
    }
    const authorStarts = [...text.matchAll(AUTHOR_START)];
    return authorStarts.map((match, i) => ({
      raw: text.slice(match.index!, authorStarts[i + 1]?.index ?? text.length).trim(),
      fragments: []
    })).filter(block => block.raw.length >= 20);
  }
}
