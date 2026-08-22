export interface TextFragment {
  text: string;
  element: HTMLElement;
  page: number;
  order: number;
}

export interface ReferenceBlock {
  raw: string;
  fragments: TextFragment[];
  index?: number;
  firstAuthorHint?: string;
}

export interface ReferenceSection {
  startPage: number;
  endPage: number;
  references: ReferenceBlock[];
  source: "zotero-structure" | "heading-scan";
  startHeading?: string;
  endHeading?: string;
}

export interface ParsedCitation {
  raw: string;
  doi?: string;
  arxiv?: string;
  title?: string;
  normalizedTitle?: string;
  containerTitle?: string;
  normalizedContainerTitle?: string;
  year?: number;
  firstAuthor?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  itemTypeHint?: "book" | "bookSection" | "conferencePaper" | "journalArticle";
}

export interface LibraryRecord {
  item: ZoteroItem;
  doi?: string;
  arxiv?: string;
  title: string;
  normalizedTitle: string;
  containerTitle?: string;
  normalizedContainerTitle?: string;
  year?: number;
  firstAuthor?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  itemType?: string;
  pdfAttachmentID?: number;
}

export interface MatchResult {
  record: LibraryRecord;
  method: "doi" | "arxiv" | "bibliographic" | "title-exact" | "title-fuzzy";
  score: number;
}
