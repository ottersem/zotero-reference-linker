import { describe, expect, it } from "vitest";
import { normalizeTitle, similarity } from "../src/core/normalize";

describe("title matching helpers", () => {
  it("normalizes punctuation and accents", () => {
    expect(normalizeTitle("Café—Robots: A Study!")) .toBe("cafe robots a study");
  });
  it("scores near-identical token sets highly", () => {
    expect(similarity("vision language action models for robots", "vision language action model for robot learning")).toBeGreaterThan(0.8);
  });
});
