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
  year?: number;
  firstAuthor?: string;
}

export interface LibraryRecord {
  item: ZoteroItem;
  doi?: string;
  arxiv?: string;
  title: string;
  normalizedTitle: string;
  year?: number;
  firstAuthor?: string;
  pdfAttachmentID?: number;
}

export interface MatchResult {
  record: LibraryRecord;
  method: "doi" | "arxiv" | "title-exact" | "title-fuzzy";
  score: number;
}
