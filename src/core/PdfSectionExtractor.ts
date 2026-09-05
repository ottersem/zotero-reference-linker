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
const ACKNOWLEDGEMENT_HEADING = /^\s*(?:\d{1,4}\s+)?acknowledg(?:e)?ments?(?:\s+\d{1,4})?\s*$/i;
const LETTERED_STOP_HEADING = /^\s*A(?:\.\d+)?(?:\.\s*|\s+)(?=[\p{Lu}])[^,.;]{2,100}\s*$/u;
const LABELED_START = /(?:^|\n)\s*(?:\[\s*((?=[^\]\n]{0,24}\d)[A-Za-z0-9][A-Za-z0-9+.:/_\-\s]{0,23})\s*\]|((?!(?:18|19|20|21)\d{2}\b)\d{1,4})[.)]|((?!(?:18|19|20|21)\d{2}\b)\d{1,4})(?=\s+(?:[A-ZÀ-ÖØ-Þ](?:\.|\s)|Technical\b)))(?:\s+|(?=\p{Lu}))/gu;
const PARTICLE = `(?:[Dd]e|[Dd]el|[Dd]en|[Dd]er|[Dd]i|[Dd]u|[Ll]a|[Ll]e|[Vv]an|[Vv]on)\\s+`;
const SURNAME = `(?:${PARTICLE}){0,3}[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+(?:\\s+[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+){0,2}`;
const INITIALS = `(?:[A-Z](?:\\.-[A-Z])?\\.(?:\\s*[A-Z](?:\\.-[A-Z])?\\.){0,5}|[A-Z](?:-[A-Z])?(?=\\s*[,;]))`;
const INITIALS_FIRST = `(?:[A-Z](?:-[A-Z])?\\.\\s*){1,5}`;
const AUTHOR_START = new RegExp(
  `(?:^|\\n)(?=\\s*(?:${SURNAME},\\s*${INITIALS}|${SURNAME}\\s+[A-Z](?:-[A-Z])?(?=\\s*[,;])|${INITIALS_FIRST}${SURNAME}(?=\\s*[,;])))`,
  "gu"
);
const ORGANIZATION_START = /(?:^|\n)(?=\s*[A-Z][^\n,]{1,80}\b(?:Collaboration|Partnership)\b[^\n]*\b(?:19|20)\d{2}[a-z]?\b)/gu;
const DITTO_START = /(?:^|\n)(?=\s*[—–-]\.\s*(?:19|20)\d{2}[a-z]?\b)/gu;
const DISCRETIONARY_HYPHEN = /[-\u00ad\u0002]\s*$/;
const CONTINUATION_LINE = "\u0001";
const PDF_DIACRITIC_ARTIFACT = /[´`^¨]\s*/g;
const SPLIT_HEADING_WORDS = [
  "references", "bibliography", "appendix", "appendices",
  "supplementary", "supplemental", "material", "acknowledgement",
  "acknowledgements", "acknowledgment", "acknowledgments"
].map(word => ({ word, pattern: new RegExp(`\\b${word.split("").join("\\s*")}\\b`, "gi") }));

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
    if (!scanned) {
      const headingless = await this.findByNumberedReferences(pdf);
      if (!headingless) return undefined;
      return this.extractRange(pdf, headingless.startPage, pdf.numPages - 1, "heading-scan", headingless.startLine);
    }
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

  private async findByNumberedReferences(pdf: PdfDocument): Promise<{ startPage: number; startLine: number } | undefined> {
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex++) {
      const lines = await this.pageLines(pdf, pageIndex);
      for (let startLine = 0; startLine < lines.length; startLine++) {
        if (!/^\s*1(?=\s+(?:[A-ZÀ-ÖØ-Þ](?:\.|\s)|Technical\b))/u.test(this.visibleLine(lines[startLine]!))) continue;
        const samplePages = [lines.slice(startLine).join("\n")];
        for (let nextPage = pageIndex + 1; nextPage < Math.min(pdf.numPages, pageIndex + 3); nextPage++) {
          samplePages.push((await this.pageLines(pdf, nextPage)).join("\n"));
        }
        const references = this.splitReferences(samplePages.join("\n"));
        if (references.length < 5) continue;
        const firstFive = references.slice(0, 5);
        if (firstFive.every((reference, index) => reference.index === index + 1)
          && firstFive.filter(reference => /\b(?:18|19|20|21)\d{2}\b/.test(reference.raw)).length >= 3) {
          return { startPage: pageIndex, startLine };
        }
      }
    }
    return undefined;
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
      const reorderedAcknowledgement = pageIndex === startPage
        ? lines.findIndex(line => ACKNOWLEDGEMENT_HEADING.test(this.visibleLine(line)))
        : -1;
      if (reorderedAcknowledgement >= 0) {
        pages.push(lines.slice(0, reorderedAcknowledgement).join("\n"));
        continue;
      }
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
    return normalize(this.visibleLine(a)) === normalize(this.visibleLine(b));
  }

  private isStopHeading(line: string): boolean {
    const visible = this.visibleLine(line);
    return STOP_HEADING.test(visible) || LETTERED_STOP_HEADING.test(visible);
  }

  private visibleLine(line: string): string {
    let visible = line.replaceAll(CONTINUATION_LINE, "");
    for (const { word, pattern } of SPLIT_HEADING_WORDS) {
      visible = visible.replace(pattern, word);
    }
    return visible;
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
    const flushLine = () => {
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
    };
    for (const item of content.items) {
      if (item.str) {
        const itemY = typeof item.transform?.[5] === "number" ? item.transform[5] : undefined;
        if (line && lineY != null && itemY != null && Math.abs(itemY - lineY) > 4) flushLine();
        if (!line) {
          lineX = typeof item.transform?.[4] === "number" ? item.transform[4] : undefined;
          lineY = itemY;
        }
        line += (line && !/[-–—\s]$/.test(line) ? " " : "") + item.str;
      }
      if (item.hasEOL) flushLine();
    }
    if (line.trim()) flushLine();
    else if (continued) lines.push({ text: continued.replace(PDF_DIACRITIC_ARTIFACT, "").trim(), x: continuedX, y: continuedY, order: lines.length });
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
      .filter(position => !recurringPositions.some(other => position > other && position - other <= 32));
    const columnLines = columnBases.map(() => [] as number[]);
    for (const value of lines) {
      if (value.x == null || value.y == null || !columnBases.length) continue;
      let best = 0;
      for (let i = 1; i < columnBases.length; i++) {
        if (Math.abs(value.x - columnBases[i]!) < Math.abs(value.x - columnBases[best]!)) best = i;
      }
      columnLines[best]!.push(value.y);
    }
    const alignedColumns = columnLines.some((left, leftIndex) => columnLines.some((right, rightIndex) => {
      if (rightIndex <= leftIndex || columnBases[rightIndex]! - columnBases[leftIndex]! < 100) return false;
      let aligned = 0;
      for (const y of left) {
        if (right.some(otherY => Math.abs(y - otherY) <= 20)) aligned++;
      }
      return aligned >= 2;
    }));
    const hasColumns = columnBases.length >= 2 && alignedColumns;
    const ordered = hasColumns ? (() => {
      const nearestColumn = (value: (typeof lines)[number]) => {
        if (value.x == null) return 0;
        let best = 0;
        for (let i = 1; i < columnBases.length; i++) {
          if (Math.abs(value.x - columnBases[i]!) < Math.abs(value.x - columnBases[best]!)) best = i;
        }
        return best;
      };
      const headingIndex = lines.findIndex(value => REFERENCE_HEADING.test(this.visibleLine(value.text)));
      const firstLabeledAfterHeading = headingIndex >= 0 ? lines.slice(headingIndex + 1).find(value =>
        /^\s*(?:\[\s*[A-Za-z0-9][^\]]{0,24}\]|\d{1,4}[.)])(?:\s+|(?=\p{Lu}))/u.test(value.text)
      ) : undefined;
      const referenceColumn = firstLabeledAfterHeading ? nearestColumn(firstLabeledAfterHeading) : 0;
      const column = (value: (typeof lines)[number]) =>
        REFERENCE_HEADING.test(this.visibleLine(value.text)) ? referenceColumn : nearestColumn(value);
      return [...lines].sort((a, b) => {
        const columnDifference = column(a) - column(b);
        if (columnDifference) return columnDifference;
        if (a.y != null && b.y != null && Math.abs(a.y - b.y) > 0.5) return b.y - a.y;
        return a.order - b.order;
      });
    })() : lines;
    return ordered.flatMap(value => {
      let line = value.text;
      if (value.x != null) {
        const indented = columnBases.some(position => value.x! - position >= 5 && value.x! - position <= 36);
        const labeled = /^\s*(?:\[\s*[A-Za-z0-9][^\]]{0,24}\]|\d{1,4}[.)])(?:\s+|(?=\p{Lu}))/u.test(value.text);
        if (indented && !labeled) line = `${CONTINUATION_LINE}${line}`;
      }
      return this.splitInlineReferenceHeading(line);
    });
  }

  private splitInlineReferenceHeading(line: string): string[] {
    const visible = this.visibleLine(line);
    const match = visible.match(/^\s*((?:\d{1,4}\s+)?(?:references cited|literature cited|works cited|references|bibliography)(?:\s+\d{1,4})?)\s+(.+)$/i);
    if (!match || !this.looksLikeReferenceStart(match[2]!)) return [line];
    return [match[1]!, match[2]!];
  }

  private looksLikeReferenceStart(value: string): boolean {
    return /^\s*(?:\[\s*[A-Za-z0-9]|\d{1,4}[.)]|[A-ZÀ-ÖØ-Þ][\p{L}'’-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'’-]+){0,2}\s*,|[A-ZÀ-ÖØ-Þ][\p{L}'’-]+\s+[A-Z](?:-[A-Z])?\s*[,;]|[A-Z](?:-[A-Z])?\.\s*[A-ZÀ-ÖØ-Þ][\p{L}'’-]+)/u.test(value);
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
    const labeledStarts = this.plausibleLabeledStarts(starts);
    if (labeledStarts.length >= 2) {
      const final = labeledStarts.at(-1)!;
      const finalNumber = Number(this.label(final));
      const numberingReset = Number.isFinite(finalNumber) ? starts.find(match => {
        if (match.index! <= final.index!) return false;
        const label = this.label(match);
        const value = /^\d+$/.test(label) ? Number(label) : undefined;
        return value != null && value <= finalNumber;
      }) : undefined;
      return labeledStarts.map((match, i) => ({
        raw: this.visibleLine(text.slice(match.index!, labeledStarts[i + 1]?.index ?? numberingReset?.index ?? text.length)).trim(),
        fragments: [],
        index: /^\d+$/.test(this.label(match)) ? Number(this.label(match)) : undefined
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
      const author = this.referenceFirstAuthor(raw);
      const organization = raw.match(/^([^,]{1,80}\b(?:Collaboration|Partnership)\b)/i)?.[1];
      const firstAuthorHint = /^[—–-]\./.test(raw) ? previousAuthor : surname(author || organization);
      if (firstAuthorHint) previousAuthor = firstAuthorHint;
      return { raw, fragments: [], firstAuthorHint };
    }).filter(block => block.raw.length >= 20);
  }

  private plausibleLabeledStarts(starts: RegExpMatchArray[]): RegExpMatchArray[] {
    if (starts.length < 2) return [];
    const numeric = starts.map(match => /^\d+$/.test(this.label(match)) ? Number(this.label(match)) : undefined);
    if (!numeric.some(value => value != null)) return starts;
    const accepted: RegExpMatchArray[] = [];
    let expected = 1;
    for (let i = 0; i < starts.length; i++) {
      if (numeric[i] !== expected) continue;
      accepted.push(starts[i]!);
      expected++;
    }
    return accepted.length >= 2 ? accepted : [];
  }

  private label(match: RegExpMatchArray): string {
    return match[1] || match[2] || match[3] || "";
  }

  private referenceFirstAuthor(raw: string): string | undefined {
    const surnameFirst = raw.match(new RegExp(`^(${SURNAME})(?:,\\s*${INITIALS}|\\s+[A-Z](?:-[A-Z])?(?=\\s*[,;]))`, "u"))?.[1];
    if (surnameFirst) return surname(surnameFirst);
    const initialsFirst = raw.match(new RegExp(`^${INITIALS_FIRST}(${SURNAME})(?=\\s*[,;])`, "u"))?.[1];
    return surname(initialsFirst);
  }
}
