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
  });
});
