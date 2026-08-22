import { describe, expect, it } from "vitest";
import { CitationParser } from "../src/core/CitationParser";
import { LibraryMatcher } from "../src/core/LibraryMatcher";
import { normalizeTitle } from "../src/core/normalize";
import type { ParsedCitation } from "../src/core/types";

interface ItemData {
  id: number;
  title: string;
  author?: string;
  year?: number;
  doi?: string;
  arxiv?: string;
  bookTitle?: string;
  publicationTitle?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  articleNumber?: string;
  itemType?: "book" | "bookSection" | "conferencePaper" | "journalArticle";
  pdf?: boolean;
}

function setup(data: ItemData[]): LibraryMatcher {
  const attachments = new Map<number, { attachmentContentType: string }>();
  const itemTypes = new Map<string, number>();
  const typeNames = new Map<number, string>();
  const items = data.map(entry => {
    const itemType = entry.itemType || "journalArticle";
    if (!itemTypes.has(itemType)) {
      const id = itemTypes.size + 1;
      itemTypes.set(itemType, id);
      typeNames.set(id, itemType);
    }
    const attachmentID = entry.id + 10_000;
    if (entry.pdf) attachments.set(attachmentID, { attachmentContentType: "application/pdf" });
    const fields: Record<string, string> = {
      title: entry.title,
      date: entry.year ? String(entry.year) : "",
      DOI: entry.doi || "",
      extra: entry.arxiv ? `arXiv: ${entry.arxiv}` : "",
      bookTitle: entry.bookTitle || "",
      publicationTitle: entry.publicationTitle || "",
      volume: entry.volume || "",
      issue: entry.issue || "",
      pages: entry.pages || "",
      articleNumber: entry.articleNumber || ""
    };
    return {
      id: entry.id,
      libraryID: 1,
      itemTypeID: itemTypes.get(itemType)!,
      isRegularItem: () => true,
      getField: (field: string) => fields[field] || "",
      getCreators: () => entry.author ? [{ lastName: entry.author }] : [],
      getAttachments: () => entry.pdf ? [attachmentID] : []
    };
  });
  const zotero = {
    Items: {
      getAll: async () => items,
      get: (id: number) => attachments.get(id) || false
    },
    ItemTypes: { getName: (id: number) => typeNames.get(id) || "" }
  } as unknown as ZoteroAPI;
  const matcher = new LibraryMatcher(zotero);
  void matcher.index(1);
  return matcher;
}

async function indexed(data: ItemData[]): Promise<LibraryMatcher> {
  const matcher = setup(data);
  await new Promise(resolve => setTimeout(resolve, 0));
  return matcher;
}

function citation(title: string, metadata: Partial<ParsedCitation> = {}): ParsedCitation {
  return { raw: title, title, normalizedTitle: normalizeTitle(title), ...metadata };
}

describe("LibraryMatcher", () => {
  it("matches a wording variant when author and year corroborate it", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "Active Label Correction for Semantic Segmentation with Foundation Models",
      author: "Kim",
      year: 2024
    }]);
    expect(matcher.match(citation(
      "Active Label Correction for Semantic Segmentation using Foundation Models",
      { firstAuthor: "kim", year: 2024 }
    ))?.method).toBe("title-fuzzy");
  });

  it("prefers a complete title over a contained shorter title", async () => {
    const matcher = await indexed([
      { id: 1, title: "Principles of Vibration and Sound", author: "Rossing", year: 2004, itemType: "book" },
      { id: 2, title: "Vibration and Sound", author: "Different", year: 1995, itemType: "book" }
    ]);
    const result = matcher.match(citation("Principles of Vibration and Sound", { firstAuthor: "rossing", year: 2004 }));
    expect(result?.record.item.id).toBe(1);
  });

  it("rejects a contained shorter title when the complete item is absent", async () => {
    const matcher = await indexed([
      { id: 2, title: "Vibration and Sound", author: "Rossing", year: 2004, itemType: "book" }
    ]);
    expect(matcher.match(citation(
      "Principles of Vibration and Sound",
      { firstAuthor: "rossing", year: 2004 }
    ))).toBeUndefined();
  });

  it("uses metadata to resolve duplicate exact titles", async () => {
    const matcher = await indexed([
      { id: 1, title: "A Shared Research Title", author: "Lee", year: 2024 },
      { id: 2, title: "A Shared Research Title", author: "Smith", year: 2018 }
    ]);
    expect(matcher.match(citation(
      "A Shared Research Title",
      { firstAuthor: "lee", year: 2024 }
    ))?.record.item.id).toBe(1);
  });

  it("abstains when duplicate exact titles cannot be distinguished", async () => {
    const matcher = await indexed([
      { id: 1, title: "A Shared Research Title" },
      { id: 2, title: "A Shared Research Title" }
    ]);
    expect(matcher.match(citation("A Shared Research Title"))).toBeUndefined();
  });

  it("distinguishes a book section from a same-title book", async () => {
    const matcher = await indexed([
      { id: 1, title: "A Shared Chapter Title", author: "Kim", year: 2022, itemType: "bookSection", bookTitle: "Collected Research Methods" },
      { id: 2, title: "A Shared Chapter Title", author: "Kim", year: 2022, itemType: "book" }
    ]);
    const result = matcher.match(citation("A Shared Chapter Title", {
      firstAuthor: "kim",
      year: 2022,
      itemTypeHint: "bookSection",
      containerTitle: "Collected Research Methods",
      normalizedContainerTitle: "collected research methods"
    }));
    expect(result?.record.item.id).toBe(1);
  });

  it("rejects a title made from the same tokens in a different order", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "Robust Active Learning for Semantic Segmentation",
      author: "Kim",
      year: 2024
    }]);
    expect(matcher.match(citation(
      "Semantic Segmentation for Robust Active Learning",
      { firstAuthor: "kim", year: 2024 }
    ))).toBeUndefined();
  });

  it("prefers the PDF-bearing duplicate for an exact DOI", async () => {
    const matcher = await indexed([
      { id: 1, title: "Metadata Only", doi: "10.1000/example" },
      { id: 2, title: "With PDF", doi: "10.1000/example", pdf: true }
    ]);
    expect(matcher.match({ raw: "", doi: "10.1000/example" })?.record.item.id).toBe(2);
  });

  it("matches the VaB-AL proceedings citation to a conference item", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "VaB-AL: Incorporating Class Imbalance and Difficulty with Variational Bayes for Active Learning",
      author: "Choi",
      year: 2020,
      itemType: "conferencePaper"
    }]);
    const parsed = new CitationParser().parse({
      raw: '[194] J. Choi, K. Yi et al., “Vab-al: Incorporating class imbalance and difficulty with variational bayes for active learning,” in Proc. of CVPR, 2021, pp. 6749–6758.',
      fragments: [],
      index: 194
    });
    expect(matcher.match(parsed)?.record.item.id).toBe(1);
  });

  it("allows exact-title matching when a citation type is unknown", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "A Paper with Numbered Pages",
      author: "Smith",
      year: 2022,
      itemType: "conferencePaper"
    }]);
    expect(matcher.match(citation("A Paper with Numbered Pages", {
      firstAuthor: "smith",
      year: 2022
    }))?.record.item.id).toBe(1);
  });

  it("treats item type as supporting metadata for an otherwise exact match", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "A Shared Chapter Title",
      author: "Kim",
      year: 2022,
      itemType: "conferencePaper"
    }]);
    expect(matcher.match(citation("A Shared Chapter Title", {
      firstAuthor: "kim",
      year: 2022,
      itemTypeHint: "bookSection",
      containerTitle: "Collected Research Methods",
      normalizedContainerTitle: "collected research methods"
    }))?.record.item.id).toBe(1);
  });

  it("rejects a book-section candidate with a conflicting container", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "A Shared Chapter Title",
      author: "Kim",
      year: 2022,
      itemType: "bookSection",
      bookTitle: "A Different Edited Volume"
    }]);
    expect(matcher.match(citation("A Shared Chapter Title", {
      firstAuthor: "kim",
      year: 2022,
      itemTypeHint: "bookSection",
      containerTitle: "Collected Research Methods",
      normalizedContainerTitle: "collected research methods"
    }))).toBeUndefined();
  });

  it("matches an unnumbered ICML-style reference from the extracted metadata", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "SLIC Superpixels Compared to State-of-the-Art Superpixel Methods",
      author: "Achanta",
      year: 2012,
      itemType: "journalArticle"
    }]);
    const parsed = new CitationParser().parse({
      raw: "Achanta, R., Shaji, A., Smith, K., Lucchi, A., Fua, P., and Süsstrunk, S. Slic superpixels compared to state-of-the-art superpixel methods. IEEE Transactions on Pattern Analysis and Machine Intelligence, 34(11):2274–2282, 2012.",
      fragments: []
    });
    expect(matcher.match(parsed)?.record.item.id).toBe(1);
  });

  it("matches a complete title when PDF line wrapping changes a word boundary", async () => {
    const matcher = await indexed([{
      id: 1,
      title: "SLIC Superpixels Compared to State-of-the-Art Superpixel Methods",
      author: "Achanta",
      year: 2012,
      itemType: "journalArticle"
    }]);
    expect(matcher.match(citation(
      "Slic superpixels compared to state-of-theart superpixel methods",
      { firstAuthor: "achanta", year: 2012 }
    ))?.record.item.id).toBe(1);
  });

  it.each([
    {
      domain: "astronomy",
      raw: "Krumholz, M. R., & Thompson, T. A. 2007, ApJ, 669, 289",
      item: { id: 10, title: "The Relationship Between Molecular Gas Tracers and Kennicutt-Schmidt Laws", author: "Krumholz", year: 2007, publicationTitle: "The Astrophysical Journal", volume: "669", pages: "289-298" }
    },
    {
      domain: "physics",
      raw: "[1] A. Einstein, Ann. Phys. 17, 891 (1905).",
      item: { id: 11, title: "On the Movement of Small Particles Suspended in Stationary Liquids Required by the Molecular-Kinetic Theory of Heat", author: "Einstein", year: 1905, publicationTitle: "Annalen der Physik", volume: "17", pages: "891-921" }
    }
  ])("connects a title-less $domain citation by bibliographic fingerprint", async ({ raw, item }) => {
    const matcher = await indexed([item]);
    const result = matcher.match(new CitationParser().parse({ raw, fragments: [] }));
    expect(result?.method).toBe("bibliographic");
    expect(result?.record.item.id).toBe(item.id);
  });

  it.each([
    {
      domain: "mathematics",
      raw: "[2] T. Tao, A quantitative ergodic theory proof of Szemeredi's theorem, Electron. J. Combin. 13 (2006), R99.",
      item: { id: 12, title: "A Quantitative Ergodic Theory Proof of Szemeredi's Theorem", author: "Tao", year: 2006 }
    },
    {
      domain: "biomedicine",
      raw: "Smith JA, Doe B. Biomarkers improve early disease detection in adults. J Med. 2020;12(3):100-110.",
      item: { id: 13, title: "Biomarkers Improve Early Disease Detection in Adults", author: "Smith", year: 2020 }
    }
  ])("connects a title-bearing $domain citation", async ({ raw, item }) => {
    const matcher = await indexed([item]);
    expect(matcher.match(new CitationParser().parse({ raw, fragments: [] }))?.record.item.id).toBe(item.id);
  });

  it("rejects an author-year candidate whose volume conflicts", async () => {
    const matcher = await indexed([{
      id: 14,
      title: "Wrong Paper",
      author: "Krumholz",
      year: 2007,
      publicationTitle: "The Astrophysical Journal",
      volume: "670",
      pages: "289"
    }]);
    const parsed = new CitationParser().parse({ raw: "Krumholz, M. R., & Thompson, T. A. 2007, ApJ, 669, 289", fragments: [] });
    expect(matcher.match(parsed)).toBeUndefined();
  });
});
