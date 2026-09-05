import { describe, expect, it } from "vitest";
import { findIndexedReferenceMarkers, ReferenceOverlay, unmatchedReferenceActions } from "../src/reader/ReferenceOverlay";

describe("findIndexedReferenceMarkers", () => {
  it("finds bracketed and plain numbered reference markers", () => {
    const text = "References 1. Mead, D. J. Paper one. 2) Sepahvand, K. Paper two. [3] Gu, M. Paper three.";
    expect(findIndexedReferenceMarkers(text).map(marker => marker.index)).toEqual([1, 2, 3]);
  });

  it("does not treat years or decimal values as reference markers", () => {
    expect(findIndexedReferenceMarkers("Paper. 1975, 40, 19-39. CFL = 1.1.")).toEqual([]);
  });

  it("marks an unmatched indexed reference with the gray-highlight class", () => {
    const page = {} as HTMLElement;
    const classes = [new Set<string>(), new Set<string>()];
    const spans = classes.map((values, index) => ({
      textContent: index ? "Missing library paper." : "1.",
      classList: { add: (...names: string[]) => names.forEach(name => values.add(name)) },
      closest: () => page
    })) as unknown as HTMLElement[];
    const style = { id: "", textContent: "" };
    const doc = {
      defaultView: { Element: class {} },
      addEventListener() {},
      getElementById: () => null,
      createElement: () => style,
      head: { append() {} }
    } as unknown as Document;
    const overlay = new ReferenceOverlay(doc, () => {});
    Object.assign(overlay, { pages: [{
      page,
      pageIndex: 0,
      spans,
      text: "1. Missing library paper.",
      offsets: [{ start: 0, end: 2 }, { start: 3, end: 25 }],
      searchableStart: 0,
      searchableEnd: 25,
      compact: { text: "", offsets: [] }
    }] });

    expect(overlay.renderIndexedUnmatched(1)).toBe(true);
    expect(classes.every(values => values.has("reference-linker-unmatched"))).toBe(true);
    expect(style.textContent).toContain(".reference-linker-unmatched");
  });
});

describe("unmatchedReferenceActions", () => {
  it("offers DOI, Scholar search, and title copy when metadata is available", () => {
    expect(unmatchedReferenceActions({
      raw: "Example reference",
      doi: "10.1234/example",
      title: "A useful paper title"
    })).toEqual([
      { kind: "open", label: "Open DOI", value: "https://doi.org/10.1234/example" },
      { kind: "open", label: "Search", value: "https://scholar.google.com/scholar?q=A%20useful%20paper%20title" },
      { kind: "copy", label: "Copy title", value: "A useful paper title" }
    ]);
  });

  it("does not offer unavailable actions", () => {
    expect(unmatchedReferenceActions({ raw: "Unparsed reference" })).toEqual([]);
  });
});
