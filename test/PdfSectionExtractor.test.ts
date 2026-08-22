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

  it("splits alphanumeric citation keys and joins discretionary line breaks", async () => {
    const document = pdf([
      "Body",
      "References\n[BCV13] Yoshua Bengio, Aaron Courville, and Pascal Vincent. Representation learn-\ning: A review and new perspectives. 2013.\n[BJP12] David M Blei, Michael I Jordan, and John W Paisley. Variational Bayesian inference with Stochastic Search. 2012.\n[BTL13] Yoshua Bengio and Eric Thibodeau-Laufer. Deep generative stochastic networks trainable by backprop. arXiv:1306.1091, 2013.\n[Online] Available: https://arxiv.org/abs/1306.1091\n[VLL + 10] Pascal Vincent, Hugo Larochelle, and Yoshua Bengio. Stacked denoising autoencoders for useful representations. 2010.\nA Visualisations\nAppendix content"
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(4);
    expect(result?.references[0]?.index).toBeUndefined();
    expect(result?.references[0]?.raw).toContain("Representation learning");
    expect(result?.references[2]?.raw).toContain("[Online]");
    expect(result?.references[3]?.raw).toContain("VLL + 10");
    expect(result?.references[3]?.raw).not.toContain("Appendix content");
  });

  it("recognizes multiword surnames in unnumbered references", async () => {
    const document = pdf([
      "References\nSong, H., Kim, M., and Lee, J. Learning from noisy labels with deep neural networks. 2022.\nVanden Bergh, M., Boix, X., and Van Gool, L. Seeds: Superpixels extracted via energy-driven sampling. 2012."
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[1]?.raw).toContain("Vanden Bergh");
  });

  it("does not treat a wrapped publication year as a numbered reference", async () => {
    const document = pdf([
      "References\nAchanta, R., and Foo, C. A complete paper title for testing. Journal Name,\n2012.\nChen, L.-C., and Adam, H. Another complete paper title for testing. Conference Name,\n2018."
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[0]?.raw).toContain("2012");
    expect(result?.references[1]?.raw).toContain("Chen, L.-C.");
  });

  it("does not split a hanging-indent continuation author into a new reference", async () => {
    const document: PdfDocument = {
      numPages: 1,
      async getPage() {
        const item = (str: string, x: number) => ({ str, hasEOL: true, transform: [1, 0, 0, 1, x, 0] });
        return { async getTextContent() { return { items: [
          item("References", 55),
          item("Jha, D., Smedsrud, P. H., Riegler, M. A., Halvorsen, P.,", 55),
          item("de Lange, T., Johansen, D., and Johansen, H. D. Kvasir-seg: A segmented polyp dataset. 2020.", 65),
          item("Joshi, A. J., Porikli, F., and Papanikolopoulos, N. Multi-class active learning for image classification. 2009.", 55)
        ] }; } };
      }
    };
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[0]?.raw).toContain("de Lange");
    expect(result?.references[1]?.raw).toContain("Joshi");
  });

  it("orders two-column references by column before splitting", async () => {
    const document: PdfDocument = {
      numPages: 1,
      async getPage() {
        const item = (str: string, x: number, y: number) => ({ str, hasEOL: true, transform: [1, 0, 0, 1, x, y] });
        return { async getTextContent() { return { items: [
          item("Bell, E. F. 2003, ApJ, 586, 794", 55, 90),
          item("References", 180, 110),
          item("Black, J. H. 2000, ApJ, 500, 100", 55, 70),
          item("Elmegreen, B. G. 1994, ApJ, 425, L73", 330, 100),
          item("Flower, D. R. 2006, A&A, 456, 215", 330, 80)
        ] }; } };
      }
    };
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references.map(reference => reference.raw.split(",")[0])).toEqual(["Bell", "Black", "Elmegreen", "Flower"]);
  });

  it("removes sequential PDF margin line numbers", async () => {
    const document = pdf([
      "References 212\nDries, R., et al. Giotto: a toolbox for spatial analysis 213\nand visualization. Genome Biol 2021;22(1):78. 214\nHao, Y., et al. Dictionary learning for single-cell analysis. 215\nNat Biotechnol 2024;42(2):293-304. 216"
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[0]?.raw).toMatch(/spatial analysis\s+and visualization/);
    expect(result?.references[0]?.raw).not.toMatch(/\b21[3-6]\b/);
  });

  it("carries the previous author into an em-dash astronomy reference", async () => {
    const document = pdf([
      "References\nKennicutt, R. C. 1998a, ARA&A, 36, 189\n—. 1998b, ApJ, 498, 541"
    ]);
    const result = await new PdfSectionExtractor().extract(document);
    expect(result?.references).toHaveLength(2);
    expect(result?.references[1]?.firstAuthorHint).toBe("kennicutt");
  });
});
