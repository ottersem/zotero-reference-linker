import { normalizeArxiv, normalizeContainerTitle, normalizeDOI, normalizeLocator, normalizeTitle, normalizeVolume, surname } from "./normalize";
import type { ParsedCitation, ReferenceBlock } from "./types";

const YEAR = /\b(19\d{2}|20\d{2})[a-z]?\b/i;
const CITATION_MARKER = /^\s*(?:\[\s*(?=[^\]\n]{0,24}\d)[A-Za-z0-9][A-Za-z0-9+.:/_\-\s]{0,23}\s*\]|\d+[.)])\s*/;
const FULL_NAME_WORD = `(?:[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+|[A-ZÀ-ÖØ-Þ]\\.?)`;
const FULL_NAME = `[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+(?:\\s+${FULL_NAME_WORD}){1,4}`;
const INITIALS_AUTHOR = `(?:[A-ZÀ-ÖØ-Þ](?:-[A-ZÀ-ÖØ-Þ])?\\.\\s*){1,5}(?:(?:de|del|den|der|di|du|la|le|van|von)\\s+){0,3}[A-ZÀ-ÖØ-Þ][\\p{L}'’-]+`;
const COMMA_TITLE = new RegExp(`^(?:${INITIALS_AUTHOR}\\s*,\\s*)+(?:and\\s+${INITIALS_AUTHOR}\\s*,\\s*)?([^,]{12,240})\\s*,\\s*(?=[A-Z])`, "iu");
const FULL_NAME_LIST = new RegExp(`^${FULL_NAME}(?:,\\s*${FULL_NAME})*(?:,?\\s+(?:and|&)\\s+${FULL_NAME})?$`, "u");
const CONFERENCE_WORD = /\b(?:conference|workshop|symposium)\b|\bproc(?:eedings)?\.?(?=\s|,|$)/i;
const CONFERENCE_ACRONYM_AFTER_IN = /\bin\s+(?:the\s+)?(?:proc(?:eedings)?\.?\s+(?:of\s+)?(?:the\s+)?)?[A-Z][A-Z0-9&-]{2,}\b/;
const CONFERENCE_ACRONYM_WITH_YEAR = /\b[A-Z][A-Z0-9&/-]{2,}\s+(?:19|20)\d{2}[a-z]?\b/;
const BOOK_SECTION_CONTEXT = /\b(?:chapter|isbn)\b|\b(?:ed|eds|editor|editors)\.?\s*(?:[,;)]|$)|\b(?:academic\s+press|university\s+press|springer|elsevier|wiley|routledge|sage|palgrave|crc\s+press)\b/i;

interface JournalMetadata {
  containerTitle: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  titleless: boolean;
}

export class CitationParser {
  parse(reference: ReferenceBlock): ParsedCitation {
    const raw = reference.raw.replace(/[´`^¨]\s*/g, "").replace(/\s+/g, " ").trim();
    const yearMatch = raw.match(YEAR);
    const journal = this.extractJournalMetadata(raw, yearMatch);
    const title = journal?.titleless ? undefined : this.extractTitle(raw, yearMatch?.index);
    const containerTitle = journal?.containerTitle || this.extractContainerTitle(raw, title);
    return {
      raw,
      doi: normalizeDOI(raw),
      arxiv: normalizeArxiv(raw),
      title,
      normalizedTitle: title ? normalizeTitle(title) : undefined,
      containerTitle,
      normalizedContainerTitle: containerTitle ? normalizeContainerTitle(containerTitle) : undefined,
      year: yearMatch ? Number(yearMatch[1]) : undefined,
      firstAuthor: this.extractFirstAuthor(raw) || reference.firstAuthorHint,
      volume: journal?.volume,
      issue: journal?.issue,
      pages: journal?.pages,
      articleNumber: journal?.articleNumber,
      itemTypeHint: this.itemTypeHint(raw, title, containerTitle)
    };
  }

  private extractFirstAuthor(raw: string): string | undefined {
    const citation = raw.replace(CITATION_MARKER, "");
    const vancouver = citation.match(/^([A-ZÀ-ÖØ-Þ][\p{L}'’-]+)\s+[A-Z]{1,4}(?=\s*[,;.])/u);
    if (vancouver?.[1]) return surname(vancouver[1]);
    const surnameFirst = citation.match(/^((?:(?:[Dd]e|[Dd]el|[Dd]en|[Dd]er|[Dd]i|[Dd]u|[Ll]a|[Ll]e|[Vv]an|[Vv]on)\s+){0,3}[A-ZÀ-ÖØ-Þ][\p{L}'’-]+(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'’-]+){0,2})\s*,/u);
    if (surnameFirst?.[1]) return surname(surnameFirst[1]);
    const organization = citation.match(/^([^,]{1,80}\b(?:Collaboration|Partnership)\b)/i);
    if (organization?.[1]) return surname(organization[1]);
    const initialsFirst = citation.match(/^(?:[A-ZÀ-ÖØ-Þ](?:[-.\s]+)){1,4}([A-ZÀ-ÖØ-Þ][\p{L}'’-]+)/u);
    if (initialsFirst?.[1]) return surname(initialsFirst[1]);
    const etAl = citation.match(/^([A-ZÀ-ÖØ-Þ][\p{L}'’-]+)\s+et\s+al\b/u);
    if (etAl?.[1]) return surname(etAl[1]);
    const fullNameFirst = citation.match(new RegExp(`^(${FULL_NAME})\\s*,`, "u"));
    if (fullNameFirst?.[1]) return surname(fullNameFirst[1]);
    const fullNameBeforeAnd = citation.match(new RegExp(`^(${FULL_NAME})\\s+(?:and|&)\\s+`, "u"));
    if (fullNameBeforeAnd?.[1]) return surname(fullNameBeforeAnd[1]);
    if (CITATION_MARKER.test(raw)) {
      const fullNameBeforePeriod = citation.match(new RegExp(`^(${FULL_NAME})\\.\\s+`, "u"));
      if (fullNameBeforePeriod?.[1]) return surname(fullNameBeforePeriod[1]);
    }
    return undefined;
  }

  private extractTitle(raw: string, yearIndex?: number): string | undefined {
    const quoted = raw.match(/[“\"]([^”\"]{12,300})[”\"]/);
    if (quoted?.[1]) return this.clean(quoted[1]);

    const citation = raw.replace(CITATION_MARKER, "");
    const mathematicalTitle = this.extractCommaDelimitedTitle(citation);
    if (mathematicalTitle) return mathematicalTitle;
    const commaTitle = citation.match(COMMA_TITLE);
    if (commaTitle?.[1] && commaTitle[1].split(/\s+/).length >= 3) return this.clean(commaTitle[1]);
    const afterAuthors = this.extractAfterAuthors(citation);
    if (afterAuthors) return afterAuthors;
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

  private extractCommaDelimitedTitle(citation: string): string | undefined {
    const parts = citation.split(/\s*,\s*/).map(value => value.trim()).filter(Boolean);
    let authorEnd = 0;
    while (authorEnd < parts.length && this.looksLikeInitialsAuthorSegment(parts[authorEnd]!)) authorEnd++;
    if (!authorEnd) return undefined;
    const venueIndex = parts.findIndex((value, index) => index > authorEnd && /\.\s*[A-Za-z]?\d+\s*(?:\(|$)/.test(value));
    if (venueIndex <= authorEnd) return undefined;
    const candidate = this.clean(parts.slice(authorEnd, venueIndex).join(", "));
    return candidate.split(/\s+/).length >= 3 ? candidate : undefined;
  }

  private looksLikeInitialsAuthorSegment(value: string): boolean {
    return value.replace(/^and\s+/i, "").split(/\s+(?:and|&)\s+/i).every(author =>
      /^(?:[A-ZÀ-ÖØ-Þ]\.(?:-[A-ZÀ-ÖØ-Þ]\.)?\s*){1,5}(?:(?:de|del|den|der|di|du|la|le|van|von)\s+){0,3}[A-ZÀ-ÖØ-Þ][\p{L}'’-]+$/iu.test(author.trim())
    );
  }

  private extractJournalMetadata(raw: string, yearMatch?: RegExpMatchArray | null): JournalMetadata | undefined {
    if (!yearMatch || yearMatch.index == null) return undefined;
    const citation = raw.replace(CITATION_MARKER, "");
    const adjustedYearIndex = Math.max(0, yearMatch.index - (raw.length - citation.length));
    const authorArea = citation.slice(0, adjustedYearIndex).replace(/[,(\s.]+$/g, "");
    const afterYear = citation.slice(adjustedYearIndex).match(
      /^(?:19\d{2}|20\d{2})[a-z]?\)?\s*,\s*([^,]{2,100}),\s*(?:vol\.?\s*)?([A-Za-z]?\d+[A-Za-z]?)(?:\s*\((\d+)\))?\s*,\s*(?:pp?\.?\s*)?([A-Za-z]?\d+(?:[-–—][A-Za-z]?\d+)?)\b/i
    );
    if (afterYear && (this.looksLikeAuthors(authorArea) || /\b(?:Collaboration|Partnership)\b/i.test(authorArea) || /^[—–-]/.test(authorArea))) {
      const locator = normalizeLocator(afterYear[4]);
      return {
        containerTitle: this.clean(afterYear[1]!),
        volume: normalizeVolume(afterYear[2]),
        issue: afterYear[3],
        pages: afterYear[4],
        articleNumber: locator && /^[a-z]/i.test(locator) ? locator.toUpperCase() : undefined,
        titleless: true
      };
    }

    const beforeYear = citation.slice(0, adjustedYearIndex);
    const yearLast = beforeYear.match(/,\s*([^,]{2,80}?)\s*,?\s+([A-Za-z]?\d+[A-Za-z]?)\s*,\s*([A-Za-z]?\d+(?:[-–—][A-Za-z]?\d+)?)\s*\($/i);
    if (!yearLast) return undefined;
    const authors = beforeYear.slice(0, yearLast.index);
    if (!this.looksLikeInitialsAuthorList(authors)) return undefined;
    const locator = normalizeLocator(yearLast[3]);
    return {
      containerTitle: this.clean(yearLast[1]!),
      volume: normalizeVolume(yearLast[2]),
      pages: yearLast[3],
      articleNumber: locator && /^[a-z]/i.test(locator) ? locator.toUpperCase() : undefined,
      titleless: true
    };
  }

  private looksLikeInitialsAuthorList(value: string): boolean {
    const authors = value.replace(/,?\s+(?:and|&)\s+/gi, ", ").split(/\s*,\s*/).filter(Boolean);
    return authors.length > 0 && authors.every(author =>
      /^(?:[A-ZÀ-ÖØ-Þ](?:-[A-ZÀ-ÖØ-Þ])?\.\s*){1,5}(?:(?:de|del|den|der|di|du|la|le|van|von)\s+){0,3}[A-ZÀ-ÖØ-Þ][\p{L}'’-]+$/iu.test(author)
    );
  }

  private extractAfterAuthors(citation: string): string | undefined {
    for (const boundary of citation.matchAll(/\.\s+(?=[A-ZÀ-ÖØ-Þ\d])/gu)) {
      const prefix = citation.slice(0, boundary.index);
      if (!this.looksLikeAuthors(prefix)) continue;
      const remainder = citation.slice(boundary.index! + boundary[0].length);
      const candidate = this.clean(remainder.split(/\.\s+(?=[A-ZÀ-ÖØ-Þ\d]|arXiv\b|doi\b|https?:)/u)[0] || "");
      const words = candidate.split(/\s+/).filter(Boolean).length;
      if (words < 2 || words > 40 || (words === 2 && normalizeTitle(candidate).length < 12) || this.looksLikeAuthors(candidate)) continue;
      if (/^(?:[A-ZÀ-ÖØ-Þ]\.\s*|\(?\s*(?:19|20)\d{2})/u.test(candidate)) continue;
      if (/\b(?:and|&)\s+[A-ZÀ-ÖØ-Þ]\.?$/u.test(candidate)) continue;
      return candidate;
    }
    return undefined;
  }

  private extractContainerTitle(raw: string, title?: string): string | undefined {
    const titleIndex = title ? raw.toLowerCase().indexOf(title.toLowerCase()) : -1;
    const searchFrom = titleIndex >= 0 && title ? titleIndex + title.length : 0;
    const remainder = raw.slice(searchFrom);
    const match = remainder.match(/(?:^|[,.;][”"]?)\s*[Ii]n\s*:?[\s]+(.{3,180}?)(?=,\s*(?:pp?\.?|vol\.?|no\.?|(?:19|20)\d{2})|\.\s*(?:doi|https?)|$)/);
    if (!match?.[1]) return undefined;
    const value = this.clean(match[1]
      .replace(/^(?:[^,]{1,80}\b(?:ed|eds|editor|editors)\.?\s*,\s*)/i, "")
      .replace(/\s*\((?:pp?\.?|pages?)\s*[^)]+\)\s*$/i, ""));
    return value.split(/,\s*(?=[A-Z][\p{L}'’-]+(?:\s+[A-Z][\p{L}'’-]+)*\s*$)/u)[0] || undefined;
  }

  private itemTypeHint(raw: string, title?: string, containerTitle?: string): ParsedCitation["itemTypeHint"] {
    if (containerTitle) {
      if (CONFERENCE_WORD.test(containerTitle) || CONFERENCE_WORD.test(raw)
        || CONFERENCE_ACRONYM_AFTER_IN.test(raw) || CONFERENCE_ACRONYM_WITH_YEAR.test(containerTitle)) {
        return "conferencePaper";
      }
      // Quoted titles and page ranges are common in both proceedings and books.
      // Only label a citation as a book section when the surrounding citation
      // contains evidence that is specific to a book or edited volume.
      if (BOOK_SECTION_CONTEXT.test(raw)) return "bookSection";
    }
    if (!containerTitle && /\b(?:edition|publisher|press|isbn)\b/i.test(raw)) return "book";
    if (title && /\b(?:vol\.?|issue|journal)\b/i.test(raw)) return "journalArticle";
    return undefined;
  }

  private looksLikeAuthors(value: string): boolean {
    return /\bet\s+al\b/i.test(value)
      || /(?:^|,\s*)[A-ZÀ-ÖØ-Þ][\p{L}'’-]+,?\s+[A-Z](?:\.|\b)/u.test(value)
      || /^(?:[A-Z]\.\s*){1,3}[\p{L}'’-]+(?:\s+(?:and|&)\s+(?:[A-Z]\.\s*){1,3}[\p{L}'’-]+)?$/u.test(value)
      || FULL_NAME_LIST.test(value)
      || (value.match(/,/g)?.length || 0) >= 2;
  }

  private clean(value: string): string {
    return value.replace(/^[:;,.\s]+|[.;,\s]+$/g, "").trim();
  }
}
