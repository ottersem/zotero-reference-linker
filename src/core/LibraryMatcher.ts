import { normalizeArxiv, normalizeDOI, normalizeTitle, similarity, surname } from "./normalize";
import type { LibraryRecord, MatchResult, ParsedCitation } from "./types";

export class LibraryMatcher {
  private searchable: Array<{ record: LibraryRecord; compactTitle: string; anchor: string }> = [];
  private byDOI = new Map<string, LibraryRecord>();
  private byArxiv = new Map<string, LibraryRecord>();
  private byTitle = new Map<string, LibraryRecord[]>();
  private byToken = new Map<string, Set<LibraryRecord>>();

  constructor(private readonly zotero: ZoteroAPI) {}

  async index(libraryID: number): Promise<void> {
    const items = await this.zotero.Items.getAll(libraryID, true, false);
    this.searchable = [];
    this.byDOI.clear();
    this.byArxiv.clear();
    this.byTitle.clear();
    this.byToken.clear();
    for (const item of items) {
      if (!item.isRegularItem()) continue;
      const title = item.getField("title");
      if (!title) continue;
      const extra = item.getField("extra") || "";
      const creators = item.getCreators();
      const attachmentIDs = item.getAttachments();
      const pdfAttachmentID = attachmentIDs.find(id => {
        const attachment = this.zotero.Items.get(id);
        return attachment && attachment.attachmentContentType === "application/pdf";
      });
      const record: LibraryRecord = {
        item,
        title,
        normalizedTitle: normalizeTitle(title),
        doi: normalizeDOI(item.getField("DOI") || extra),
        arxiv: normalizeArxiv(extra + " " + item.getField("url")),
        year: this.year(item.getField("date")),
        firstAuthor: surname(creators[0]?.lastName || creators[0]?.name),
        pdfAttachmentID
      };
      const titleWords = record.normalizedTitle.split(" ").filter(Boolean);
      const compactTitle = titleWords.join("");
      this.searchable.push({
        record,
        compactTitle,
        anchor: compactTitle.slice(0, 8)
      });
      for (const token of new Set(titleWords.filter(word => word.length > 2))) {
        const records = this.byToken.get(token) || new Set<LibraryRecord>();
        records.add(record);
        this.byToken.set(token, records);
      }
      if (record.doi) this.byDOI.set(record.doi, record);
      if (record.arxiv) this.byArxiv.set(record.arxiv, record);
      const titled = this.byTitle.get(record.normalizedTitle) || [];
      titled.push(record);
      this.byTitle.set(record.normalizedTitle, titled);
    }
  }

  match(citation: ParsedCitation): MatchResult | undefined {
    if (citation.doi) {
      const record = this.byDOI.get(citation.doi);
      if (record) return { record, method: "doi", score: 1 };
    }
    if (citation.arxiv) {
      const record = this.byArxiv.get(citation.arxiv);
      if (record) return { record, method: "arxiv", score: 1 };
    }
    if (!citation.normalizedTitle || citation.normalizedTitle.length < 12) return undefined;
    const exact = this.bestMetadata(this.byTitle.get(citation.normalizedTitle) || [], citation);
    if (exact) return { record: exact, method: "title-exact", score: 0.98 };

    const candidates = new Set<LibraryRecord>();
    for (const token of citation.normalizedTitle.split(" ").filter(word => word.length > 2)) {
      for (const record of this.byToken.get(token) || []) candidates.add(record);
    }
    let best: { record: LibraryRecord; score: number } | undefined;
    for (const record of candidates) {
      const titleScore = similarity(citation.normalizedTitle, record.normalizedTitle);
      if (titleScore < 0.8) continue;
      const yearBonus = citation.year && record.year ? (citation.year === record.year ? 0.06 : Math.abs(citation.year - record.year) <= 1 ? 0.02 : -0.12) : 0;
      const authorBonus = citation.firstAuthor && record.firstAuthor ? (citation.firstAuthor === record.firstAuthor ? 0.06 : -0.04) : 0;
      const score = titleScore + yearBonus + authorBonus;
      if (!best || score > best.score) best = { record, score };
    }
    return best && best.score >= 0.84 ? { ...best, method: "title-fuzzy" } : undefined;
  }

  findTitlesInText(value: string): MatchResult[] {
    const normalized = normalizeTitle(value);
    const compact = normalized.replace(/\s/g, "");
    const anchors = new Set<string>();
    for (let i = 0; i <= compact.length - 8; i++) anchors.add(compact.slice(i, i + 8));
    const results: MatchResult[] = [];
    for (const { record, compactTitle, anchor } of this.searchable) {
      if (!anchors.has(anchor)) continue;
      if (compactTitle.length >= 12 && compact.includes(compactTitle)) {
        results.push({ record, method: "title-exact", score: 0.98 });
      }
    }
    return results;
  }

  private bestMetadata(records: LibraryRecord[], citation: ParsedCitation): LibraryRecord | undefined {
    return [...records].sort((a, b) => this.metadataScore(b, citation) - this.metadataScore(a, citation))[0];
  }

  private metadataScore(record: LibraryRecord, citation: ParsedCitation): number {
    return Number(record.year === citation.year) + Number(record.firstAuthor === citation.firstAuthor);
  }

  private year(value: string): number | undefined {
    const match = value.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? Number(match[1]) : undefined;
  }
}
