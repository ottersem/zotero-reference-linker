import { normalizeArxiv, normalizeContainerTitle, normalizeDOI, normalizeLocator, normalizeTitle, normalizeVolume, surname, titleSimilarity } from "./normalize";
import type { LibraryRecord, MatchResult, ParsedCitation } from "./types";

interface ScoredCandidate {
  record: LibraryRecord;
  exact: boolean;
  score: number;
}

interface MetadataCheck {
  authorMatch: boolean;
  yearMatch: boolean;
  containerMatch: boolean;
  itemTypeMatch: boolean;
}

export class LibraryMatcher {
  private byDOI = new Map<string, LibraryRecord[]>();
  private byArxiv = new Map<string, LibraryRecord[]>();
  private byTitle = new Map<string, LibraryRecord[]>();
  private byCompactTitle = new Map<string, LibraryRecord[]>();
  private byToken = new Map<string, Set<LibraryRecord>>();
  private byAuthorYear = new Map<string, LibraryRecord[]>();

  constructor(private readonly zotero: ZoteroAPI) {}

  async index(libraryID: number): Promise<void> {
    const items = await this.zotero.Items.getAll(libraryID, true, false);
    this.byDOI.clear();
    this.byArxiv.clear();
    this.byTitle.clear();
    this.byCompactTitle.clear();
    this.byToken.clear();
    this.byAuthorYear.clear();

    for (const item of items) {
      if (!item.isRegularItem()) continue;
      const title = this.field(item, "title");
      if (!title) continue;
      const extra = this.field(item, "extra");
      const creators = item.getCreators();
      const containerTitle = this.field(item, "bookTitle")
        || this.field(item, "proceedingsTitle")
        || this.field(item, "publicationTitle")
        || undefined;
      const pdfAttachmentID = item.getAttachments().find(id => {
        const attachment = this.zotero.Items.get(id);
        return attachment && attachment.attachmentContentType === "application/pdf";
      });
      const record: LibraryRecord = {
        item,
        title,
        normalizedTitle: normalizeTitle(title),
        containerTitle,
        normalizedContainerTitle: containerTitle ? normalizeContainerTitle(containerTitle) : undefined,
        doi: normalizeDOI(this.field(item, "DOI") || extra),
        arxiv: normalizeArxiv(`${extra} ${this.field(item, "url")}`),
        year: this.year(this.field(item, "date")),
        firstAuthor: surname(creators[0]?.lastName || creators[0]?.name),
        volume: normalizeVolume(this.field(item, "volume")),
        issue: this.field(item, "issue") || undefined,
        pages: this.field(item, "pages") || undefined,
        articleNumber: this.field(item, "articleNumber") || undefined,
        itemType: this.itemType(item),
        pdfAttachmentID
      };

      for (const token of new Set(this.tokens(record.normalizedTitle))) {
        const records = this.byToken.get(token) || new Set<LibraryRecord>();
        records.add(record);
        this.byToken.set(token, records);
      }
      if (record.doi) this.add(this.byDOI, record.doi, record);
      if (record.arxiv) this.add(this.byArxiv, record.arxiv, record);
      this.add(this.byTitle, record.normalizedTitle, record);
      this.add(this.byCompactTitle, this.compact(record.normalizedTitle), record);
      if (record.firstAuthor && record.year) this.add(this.byAuthorYear, this.authorYearKey(record.firstAuthor, record.year), record);
    }
  }

  match(citation: ParsedCitation): MatchResult | undefined {
    if (citation.doi) {
      const record = this.preferredIdentifierRecord(this.byDOI.get(citation.doi) || [], citation);
      if (record) return { record, method: "doi", score: 1 };
    }
    if (citation.arxiv) {
      const record = this.preferredIdentifierRecord(this.byArxiv.get(citation.arxiv) || [], citation);
      if (record) return { record, method: "arxiv", score: 1 };
    }
    const bibliographic = this.matchBibliographic(citation);
    if (bibliographic) return bibliographic;
    if (!citation.normalizedTitle || citation.normalizedTitle.length < 12) return undefined;

    const exact = (this.byTitle.get(citation.normalizedTitle) || [])
      .map(record => this.scoreCandidate(record, citation, true))
      .filter((candidate): candidate is ScoredCandidate => Boolean(candidate));
    if (exact.length) return this.resolve(exact, "title-exact");

    const compactExact = (this.byCompactTitle.get(this.compact(citation.normalizedTitle)) || [])
      .filter(record => record.normalizedTitle !== citation.normalizedTitle)
      .map(record => this.scoreCandidate(record, citation, true))
      .filter((candidate): candidate is ScoredCandidate => Boolean(candidate));
    if (compactExact.length) return this.resolve(compactExact, "title-exact");

    const records = new Set<LibraryRecord>();
    for (const token of this.tokens(citation.normalizedTitle)) {
      for (const record of this.byToken.get(token) || []) records.add(record);
    }
    const fuzzy = [...records]
      .filter(record => record.normalizedTitle !== citation.normalizedTitle)
      .map(record => this.scoreCandidate(record, citation, false))
      .filter((candidate): candidate is ScoredCandidate => Boolean(candidate));
    return this.resolve(fuzzy, "title-fuzzy");
  }

  private matchBibliographic(citation: ParsedCitation): MatchResult | undefined {
    if (citation.normalizedTitle || !citation.firstAuthor || !citation.year) return undefined;
    const candidates = this.byAuthorYear.get(this.authorYearKey(citation.firstAuthor, citation.year)) || [];
    const scored = candidates.flatMap(record => {
      let matches = 0;
      let score = 0.45;
      const citationLocator = normalizeLocator(citation.articleNumber || citation.pages);
      const recordLocator = normalizeLocator(record.articleNumber || record.pages);

      if (citation.normalizedContainerTitle && record.normalizedContainerTitle) {
        if (citation.normalizedContainerTitle !== record.normalizedContainerTitle) return [];
        matches++;
        score += 0.18;
      }
      if (citation.volume && record.volume) {
        if (normalizeVolume(citation.volume) !== normalizeVolume(record.volume)) return [];
        matches++;
        score += 0.16;
      }
      if (citationLocator && recordLocator) {
        if (citationLocator !== recordLocator) return [];
        matches++;
        score += 0.2;
      }
      const strongEnough = matches >= 2 && Boolean(citationLocator || (citation.normalizedContainerTitle && citation.volume));
      return strongEnough ? [{ record, exact: true, score }] : [];
    });
    return this.resolve(scored, "bibliographic");
  }

  private scoreCandidate(record: LibraryRecord, citation: ParsedCitation, exact: boolean): ScoredCandidate | undefined {
    const metadata = this.checkMetadata(record, citation);
    if (!metadata) return undefined;

    let titleScore = 1;
    if (!exact) {
      titleScore = titleSimilarity(citation.normalizedTitle!, record.normalizedTitle) || 0;
      if (!titleScore && metadata.authorMatch && metadata.yearMatch) {
        titleScore = titleSimilarity(citation.normalizedTitle!, record.normalizedTitle, true) || 0;
      }
      if (!titleScore) return undefined;
      if (!metadata.authorMatch && !metadata.yearMatch && !metadata.containerMatch && !metadata.itemTypeMatch) return undefined;
    }

    return {
      record,
      exact,
      score: titleScore
        + Number(metadata.authorMatch) * 0.08
        + Number(metadata.yearMatch) * 0.04
        + Number(metadata.containerMatch) * 0.05
        + Number(metadata.itemTypeMatch) * 0.03
    };
  }

  private checkMetadata(record: LibraryRecord, citation: ParsedCitation): MetadataCheck | undefined {
    const authorMatch = Boolean(citation.firstAuthor && record.firstAuthor && citation.firstAuthor === record.firstAuthor);
    if (citation.firstAuthor && record.firstAuthor && !authorMatch) return undefined;

    const yearMatch = Boolean(citation.year && record.year && citation.year === record.year);
    if (citation.year && record.year && Math.abs(citation.year - record.year) > 1) return undefined;

    const itemTypeMatch = Boolean(citation.itemTypeHint && record.itemType && citation.itemTypeHint === record.itemType);

    let containerMatch = false;
    if (citation.normalizedContainerTitle && record.normalizedContainerTitle) {
      containerMatch = citation.normalizedContainerTitle === record.normalizedContainerTitle
        || titleSimilarity(citation.normalizedContainerTitle, record.normalizedContainerTitle) != null;
      if (citation.itemTypeHint === "bookSection" && record.itemType === "bookSection" && !containerMatch) return undefined;
    }
    return { authorMatch, yearMatch, containerMatch, itemTypeMatch };
  }

  private resolve(candidates: ScoredCandidate[], method: MatchResult["method"]): MatchResult | undefined {
    candidates.sort((a, b) => b.score - a.score || a.record.item.id - b.record.item.id);
    const first = candidates[0];
    if (!first) return undefined;
    const second = candidates[1];
    if (second && first.score - second.score < 0.06) return undefined;
    return { record: first.record, method, score: Math.min(first.score, 0.99) };
  }

  private preferredIdentifierRecord(records: LibraryRecord[], citation: ParsedCitation): LibraryRecord | undefined {
    return [...records].sort((a, b) => {
      const pdf = Number(Boolean(b.pdfAttachmentID)) - Number(Boolean(a.pdfAttachmentID));
      if (pdf) return pdf;
      const metadata = this.identifierMetadataScore(b, citation) - this.identifierMetadataScore(a, citation);
      return metadata || a.item.id - b.item.id;
    })[0];
  }

  private identifierMetadataScore(record: LibraryRecord, citation: ParsedCitation): number {
    return Number(Boolean(citation.firstAuthor && record.firstAuthor === citation.firstAuthor))
      + Number(Boolean(citation.year && record.year === citation.year));
  }

  private itemType(item: ZoteroItem): string | undefined {
    try {
      return this.zotero.ItemTypes?.getName(item.itemTypeID) || (this.field(item, "bookTitle") ? "bookSection" : undefined);
    } catch {
      return this.field(item, "bookTitle") ? "bookSection" : undefined;
    }
  }

  private field(item: ZoteroItem, name: string): string {
    try {
      return item.getField(name) || "";
    } catch {
      return "";
    }
  }

  private tokens(value: string): string[] {
    return value.split(" ").filter(word => word.length > 2);
  }

  private compact(value: string): string {
    return value.replace(/\s+/g, "");
  }

  private add(map: Map<string, LibraryRecord[]>, key: string, record: LibraryRecord): void {
    const records = map.get(key) || [];
    records.push(record);
    map.set(key, records);
  }

  private authorYearKey(author: string, year: number): string {
    return `${author}\u0000${year}`;
  }

  private year(value: string): number | undefined {
    const match = value.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? Number(match[1]) : undefined;
  }
}
