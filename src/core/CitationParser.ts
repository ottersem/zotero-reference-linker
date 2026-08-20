import { normalizeArxiv, normalizeDOI, normalizeTitle, surname } from "./normalize";
import type { ParsedCitation, ReferenceBlock } from "./types";

const YEAR = /\b(19\d{2}|20\d{2})[a-z]?\b/i;

export class CitationParser {
  parse(reference: ReferenceBlock): ParsedCitation {
    const raw = reference.raw.replace(/\s+/g, " ").trim();
    const yearMatch = raw.match(YEAR);
    const title = this.extractTitle(raw, yearMatch?.index);
    const authorArea = yearMatch?.index == null ? raw.slice(0, 120) : raw.slice(0, yearMatch.index);
    return {
      raw,
      doi: normalizeDOI(raw),
      arxiv: normalizeArxiv(raw),
      title,
      normalizedTitle: title ? normalizeTitle(title) : undefined,
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      firstAuthor: surname(authorArea.split(/,|\band\b|&/i)[0])
    };
  }

  private extractTitle(raw: string, yearIndex?: number): string | undefined {
    const quoted = raw.match(/[“\"]([^”\"]{12,300})[”\"]/);
    if (quoted?.[1]) return this.clean(quoted[1]);

    const citation = raw.replace(/^\s*(?:\[\s*\d+\s*\]|\d+[.)])\s*/, "");
    const protectedCitation = citation.replace(/\b([A-Z])\.\s*/g, "$1\u0000");
    const segments = protectedCitation
      .split(/\.\s+(?=[A-Z\d])/)
      .map(value => this.clean(value.replace(/\u0000/g, ". ")))
      .filter(Boolean);
    const candidate = segments.find((segment, index) => {
      const words = segment.split(/\s+/).length;
      if (words < 3 || words > 40 || /^(doi|arxiv|vol|pp|https?|in\s+(proceedings|proc\.|conference|journal))/i.test(segment)) return false;
      if (index === 0 && this.looksLikeAuthors(segment)) return false;
      return !/^\(?\s*(?:19|20)\d{2}[a-z]?\s*\)?$/i.test(segment);
    });
    if (candidate) return candidate;

    const afterYear = yearIndex == null ? citation : citation.slice(yearIndex).replace(YEAR, "");
    const commaSegments = afterYear.split(/,\s+/).map(this.clean).filter(Boolean);
    return commaSegments.find(segment => segment.split(/\s+/).length >= 4);
  }

  private looksLikeAuthors(value: string): boolean {
    return /\bet\s+al\b/i.test(value)
      || /(?:^|,\s*)[A-ZÀ-ÖØ-Þ][\p{L}'’-]+,?\s+[A-Z](?:\.|\b)/u.test(value)
      || /^(?:[A-Z]\.\s*){1,3}[\p{L}'’-]+(?:\s+(?:and|&)\s+(?:[A-Z]\.\s*){1,3}[\p{L}'’-]+)?$/u.test(value)
      || (value.match(/,/g)?.length || 0) >= 2;
  }

  private clean(value: string): string {
    return value.replace(/^[:;,.\s]+|[.;,\s]+$/g, "").trim();
  }
}
