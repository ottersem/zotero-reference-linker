import { describe, expect, it } from "vitest";
import { LibraryMatcher } from "../src/core/LibraryMatcher";

describe("LibraryMatcher rendered-title scan", () => {
  it("finds a library title split by PDF line-end hyphenation", async () => {
    const item = {
      id: 1,
      libraryID: 1,
      isRegularItem: () => true,
      getField: (field: string) => field === "title" ? "Active Label Correction for Semantic Segmentation with Foundation Models" : "",
      getCreators: () => [{ lastName: "Kim" }],
      getAttachments: () => []
    };
    const zotero = {
      Items: { getAll: async () => [item], get: () => false }
    } as unknown as ZoteroAPI;
    const matcher = new LibraryMatcher(zotero);
    await matcher.index(1);
    const matches = matcher.findTitlesInText("Kim, H. 2024. Ac- tive La- bel Correction for Semantic Seg- mentation with Foundation Models.");
    expect(matches.map(match => match.record.item.id)).toEqual([1]);
    expect(matcher.match({
      raw: "",
      title: "Active Label Correction for Semantic Segmentation using Foundation Models",
      normalizedTitle: "active label correction for semantic segmentation using foundation models"
    })?.method).toBe("title-fuzzy");
  });
});
