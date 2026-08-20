import { describe, expect, it } from "vitest";
import { PdfSectionExtractor, type PdfDocument } from "../src/core/PdfSectionExtractor";

function pdf(pages: string[], outline: unknown = null): PdfDocument {
  return {
    numPages: pages.length,
    async getOutline2() { return outline as never; },
    async getPage(pageNumber) {
      return {
        async getTextContent() {
          return { items: pages[pageNumber - 1]!.split("\n").map(str => ({ str, hasEOL: true })) };
        }
      };
    }
  };
}

describe("PdfSectionExtractor", () => {
  it("uses Zotero's structured outline without relying on document position", async () => {
    const document = pdf([
      "Introduction",
      "Appendix with many pages",
      "References\n[1] A. Author. A useful paper title. Journal, 2020.\n[2] B. Author. Another useful paper. 2021.",
      "Supplement"
    ], [
      { title: "Introduction", location: { position: { pageIndex: 0 } } },
      { title: "References", location: { position: { pageIndex: 2 } } },
      { title: "Supplement", location: { position: { pageIndex: 3 } } }
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.source).toBe("zotero-structure");
    expect(result?.startPage).toBe(2);
    expect(result?.references).toHaveLength(2);
  });

  it("scans headings across the whole document and stops at Appendix", async () => {
    const document = pdf([
      "Body",
      "REFERENCES\n[1] A. Author. A useful paper title. Journal, 2020.",
      "[2] B. Author. Another useful paper. 2021.\nAppendix\nExtra material",
      "More appendix"
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.source).toBe("heading-scan");
    expect(result?.references).toHaveLength(2);
    expect(result?.references[1]?.raw).not.toContain("Extra material");
  });

  it("splits unnumbered author-year references with long author lists", async () => {
    const document = pdf([
      "Body",
      "References\nAchanta, R., Shaji, A., Smith, K., Lucchi, A., Fua, P., and Süsstrunk, S. SLIC superpixels compared to state-of-the-art superpixel methods. IEEE Transactions on Pattern Analysis and Machine Intelligence, 34(11):2274–2282, 2012.\nKim, H., Hwang, S., Kwak, S., and Ok, J. Active Label Correction for Semantic Segmentation with Foundation Models. In Forty-first International Conference on Machine Learning, 2024."
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[1]?.raw).toContain("Active Label Correction");
  });

  it("stops at an Appendix omitted from the PDF outline", async () => {
    const document = pdf([
      "Body",
      "References\nKim, H., and Ok, J. A useful reference title. Journal, 2024.",
      "Appendix A\nKim, H., and Ok, J. This is appendix prose, not a reference."
    ], [{ title: "References", location: { position: { pageIndex: 1 } } }]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.endPage).toBe(2);
    expect(result?.references).toHaveLength(1);
    expect(result?.references[0]?.raw).not.toContain("appendix prose");
  });
});
