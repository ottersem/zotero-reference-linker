import { describe, expect, it } from "vitest";
import { normalizeTitle, similarity, titleSimilarity } from "../src/core/normalize";

describe("title matching helpers", () => {
  it("normalizes punctuation and accents", () => {
    expect(normalizeTitle("Café—Robots: A Study!")) .toBe("cafe robots a study");
  });
  it("scores near-identical token sets highly", () => {
    expect(similarity(
      "active label correction for semantic segmentation using foundation models",
      "active label correction for semantic segmentation with foundation models"
    )).toBeGreaterThan(0.8);
  });
  it("rejects proper subsets and reordered token sets", () => {
    expect(titleSimilarity("principles of vibration and sound", "vibration and sound")).toBeUndefined();
    expect(titleSimilarity(
      "robust active learning for semantic segmentation",
      "semantic segmentation for robust active learning"
    )).toBeUndefined();
  });
  it("rejects generated partial and reordered titles", () => {
    for (let run = 0; run < 1_000; run++) {
      const words = Array.from({ length: 6 + run % 7 }, (_, index) => `term${run.toString(36)}x${index.toString(36)}`);
      const full = words.join(" ");
      const partial = words.filter((_, index) => index !== 1 && index !== words.length - 2).join(" ");
      const reordered = [words[1], words[0], ...words.slice(2)].join(" ");
      expect(titleSimilarity(full, partial)).toBeUndefined();
      expect(titleSimilarity(full, reordered)).toBeUndefined();
    }
  });
});
