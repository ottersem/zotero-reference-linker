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

    const afterYear = yearIndex == null ? raw : raw.slice(yearIndex).replace(YEAR, "");
    const segments = afterYear.split(/\.\s+(?=[A-Z\d])/).map(this.clean).filter(Boolean);
    const candidate = segments.find(segment => {
      const words = segment.split(/\s+/).length;
      return words >= 3 && words <= 40 && !/^(doi|arxiv|vol|pp|https?)/i.test(segment);
    });
    if (candidate) return candidate;

    const commaSegments = afterYear.split(/,\s+/).map(this.clean).filter(Boolean);
    return commaSegments.find(segment => segment.split(/\s+/).length >= 4);
  }

  private clean(value: string): string {
    return value.replace(/^[:;,.\s]+|[.;,\s]+$/g, "").trim();
  }
}
