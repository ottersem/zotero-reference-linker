import { describe, expect, it } from "vitest";
import { CitationParser } from "../src/core/CitationParser";

const parser = new CitationParser();
const block = (raw: string) => ({ raw, fragments: [] });

describe("CitationParser", () => {
  it("extracts DOI, year, author, and title", () => {
    const result = parser.parse(block('[12] Vaswani, A. et al. (2017). Attention Is All You Need. NeurIPS. doi:10.5555/1234.5678'));
    expect(result.doi).toBe("10.5555/1234.5678");
    expect(result.year).toBe(2017);
    expect(result.firstAuthor).toBe("vaswani");
    expect(result.normalizedTitle).toBe("attention is all you need");
  });

  it("normalizes versioned arXiv IDs", () => {
    expect(parser.parse(block("Smith, J. (2024). A useful paper. arXiv:2401.12345v3")).arxiv).toBe("2401.12345");
  });

  it("extracts a title when an IEEE-style year appears at the end", () => {
    const result = parser.parse(block("[7] T. N. Kipf and M. Welling. Semi-Supervised Classification with Graph Convolutional Networks. In ICLR, 2017."));
    expect(result.normalizedTitle).toBe("semi supervised classification with graph convolutional networks");
    expect(result.year).toBe(2017);
    expect(result.firstAuthor).toBe("kipf");
  });

  it("does not confuse an IEEE venue with a single author", () => {
    const result = parser.parse(block("[9] J. Smith. A Reliable Paper Title. Journal of Testing, vol. 5, 2024."));
    expect(result.firstAuthor).toBe("smith");
    expect(result.normalizedTitle).toBe("a reliable paper title");
  });

  it("extracts book-section container metadata", () => {
    const result = parser.parse(block('Kim, H. (2022). "A Shared Chapter Title." In Collected Research Methods, pp. 10-24. Academic Press.'));
    expect(result.normalizedTitle).toBe("a shared chapter title");
    expect(result.normalizedContainerTitle).toBe("collected research methods");
    expect(result.itemTypeHint).toBe("bookSection");
  });

  it("classifies an abbreviated proceedings citation as a conference paper", () => {
    const result = parser.parse(block('[194] J. Choi, K. Yi et al., “Vab-al: Incorporating class imbalance and difficulty with variational bayes for active learning,” in Proc. of CVPR, 2021, pp. 6749–6758.'));
    expect(result.normalizedTitle).toBe("vab al incorporating class imbalance and difficulty with variational bayes for active learning");
    expect(result.firstAuthor).toBe("choi");
    expect(result.year).toBe(2021);
    expect(result.normalizedContainerTitle).toBe("proc of cvpr");
    expect(result.itemTypeHint).toBe("conferencePaper");
  });

  it("does not infer a book section from quotes and page numbers alone", () => {
    const result = parser.parse(block('J. Smith, “A paper with numbered pages,” in Collected Research, pp. 10–20, 2022.'));
    expect(result.itemTypeHint).toBeUndefined();
  });

  it("recognizes a bare conference acronym after In", () => {
    const result = parser.parse(block('A. Author, “A useful method for testing,” in ICML, 2024.'));
    expect(result.itemTypeHint).toBe("conferencePaper");
  });

  it("parses a BibTeX-style citation key with full given names", () => {
    const result = parser.parse(block("[BCV13] Yoshua Bengio, Aaron Courville, and Pascal Vincent. Representation learning: A review and new perspectives. 2013."));
    expect(result.firstAuthor).toBe("bengio");
    expect(result.normalizedTitle).toBe("representation learning a review and new perspectives");
    expect(result.year).toBe(2013);
  });

  it("separates an ICML-style author list from an unquoted title", () => {
    const result = parser.parse(block("Achanta, R., Shaji, A., Smith, K., Lucchi, A., Fua, P., and Süsstrunk, S. Slic superpixels compared to state-of-the-art superpixel methods. IEEE Transactions on Pattern Analysis and Machine Intelligence, 34(11):2274–2282, 2012."));
    expect(result.firstAuthor).toBe("achanta");
    expect(result.normalizedTitle).toBe("slic superpixels compared to state of the art superpixel methods");
    expect(result.year).toBe(2012);
  });

  it("parses a multiword surname", () => {
    const result = parser.parse(block("Vanden Bergh, M., Boix, X., and Van Gool, L. Seeds: Superpixels extracted via energy-driven sampling. In Computer Vision–ECCV 2012, 2012."));
    expect(result.firstAuthor).toBe("bergh");
    expect(result.normalizedTitle).toBe("seeds superpixels extracted via energy driven sampling");
    expect(result.itemTypeHint).toBe("conferencePaper");
  });

  it("stops an unquoted title before lowercase arXiv metadata", () => {
    const result = parser.parse(block("Liu, S., Zeng, Z., Ren, T., et al. Grounding dino: Marrying dino with grounded pre-training for open-set object detection. arXiv preprint arXiv:2303.05499, 2023."));
    expect(result.normalizedTitle).toBe("grounding dino marrying dino with grounded pre training for open set object detection");
    expect(result.arxiv).toBe("2303.05499");
  });

  it("parses a labeled single author written with a full given name", () => {
    const result = parser.parse(block("[Dev86] Luc Devroye. Sample-based non-uniform random variate generation. In Proceedings of the Winter Simulation Conference, 1986."));
    expect(result.firstAuthor).toBe("devroye");
    expect(result.normalizedTitle).toBe("sample based non uniform random variate generation");
  });

  it("parses a spaced citation key and full names with a middle initial", () => {
    const result = parser.parse(block("[VLL + 10] Pascal Vincent, Hugo Larochelle, Isabelle Lajoie, Yoshua Bengio, and Pierre-Antoine Manzagol. Stacked denoising autoencoders: Learning useful representations in a deep network. 2010."));
    expect(result.firstAuthor).toBe("vincent");
    expect(result.normalizedTitle).toBe("stacked denoising autoencoders learning useful representations in a deep network");
  });

  it("accepts a short but distinctive two-word title", () => {
    const result = parser.parse(block("Kirillov, A., Mintun, E., Ravi, N., and Girshick, R. Segment anything. In Proceedings of the IEEE/CVF International Conference on Computer Vision, 2023."));
    expect(result.normalizedTitle).toBe("segment anything");
  });

  it("repairs detached PDF diacritics in an author surname", () => {
    const result = parser.parse(block("M¨ uller, N. M. and Markert, K. Identifying mislabeled instances in classification datasets. In IJCNN, 2019."));
    expect(result.firstAuthor).toBe("muller");
    expect(result.normalizedTitle).toBe("identifying mislabeled instances in classification datasets");
  });

  it("parses a title-less A&A astronomy reference", () => {
    const result = parser.parse(block("Krumholz, M. R., & Thompson, T. A. 2007, ApJ, 669, 289"));
    expect(result).toMatchObject({
      firstAuthor: "krumholz",
      year: 2007,
      title: undefined,
      normalizedContainerTitle: "astrophysical journal",
      volume: "669",
      pages: "289"
    });
  });

  it("parses an astronomy article number", () => {
    const result = parser.parse(block("Planck Collaboration XIII. 2016, A&A, 594, A13"));
    expect(result).toMatchObject({
      firstAuthor: "collaboration",
      normalizedContainerTitle: "astronomy astrophysics",
      volume: "594",
      articleNumber: "A13"
    });
  });

  it("parses a title-less physics reference with the year last", () => {
    const result = parser.parse(block("[1] A. Einstein, Ann. Phys. 17, 891 (1905)."));
    expect(result).toMatchObject({
      firstAuthor: "einstein",
      year: 1905,
      title: undefined,
      normalizedContainerTitle: "annalen physik",
      volume: "17",
      pages: "891"
    });
  });

  it("parses a comma-delimited mathematics title", () => {
    const result = parser.parse(block("[2] T. Tao, A quantitative ergodic theory proof of Szemeredi's theorem, Electron. J. Combin. 13 (2006), R99."));
    expect(result.firstAuthor).toBe("tao");
    expect(result.normalizedTitle).toBe("a quantitative ergodic theory proof of szemeredi s theorem");
    expect(result.year).toBe(2006);
  });

  it("parses a Vancouver biomedical reference", () => {
    const result = parser.parse(block("Smith JA, Doe B. Biomarkers improve early disease detection in adults. J Med. 2020;12(3):100-110."));
    expect(result.firstAuthor).toBe("smith");
    expect(result.normalizedTitle).toBe("biomarkers improve early disease detection in adults");
    expect(result.year).toBe(2020);
  });
});
