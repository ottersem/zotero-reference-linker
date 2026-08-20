import type { ReferenceBlock, TextFragment } from "./types";

const HEADING = /^\s*(references|bibliography|works cited)\s*$/i;
const NUMBERED = /^\s*(?:\[(\d{1,4})\]|(\d{1,4})[.)])\s+/;
const AUTHOR_YEAR = /^\s*[A-ZÀ-ÖØ-Þ][\p{L}'’-]+(?:,|\s).{0,100}\b(?:19|20)\d{2}[a-z]?\b/u;

export class ReferenceExtractor {
  extract(doc: Document): ReferenceBlock[] {
    const fragments = this.collectFragments(doc);
    const headingIndex = fragments.findIndex(fragment => HEADING.test(fragment.text));
    if (headingIndex < 0) return [];
    const body = fragments.slice(headingIndex + 1);
    return this.group(body);
  }

  private collectFragments(doc: Document): TextFragment[] {
    const pages = Array.from(doc.querySelectorAll<HTMLElement>(".page"));
    const fragments: TextFragment[] = [];
    pages.forEach((page, pageIndex) => {
      const pageNumber = Number(page.dataset.pageNumber) || pageIndex + 1;
      const nodes = page.querySelectorAll<HTMLElement>(".textLayer span, .textLayer br");
      nodes.forEach((element, order) => {
        if (element.tagName === "BR") return;
        const text = element.textContent?.trim();
        if (text) fragments.push({ text, element, page: pageNumber, order });
      });
    });
    return fragments;
  }

  private group(fragments: TextFragment[]): ReferenceBlock[] {
    const blocks: ReferenceBlock[] = [];
    let current: ReferenceBlock | undefined;
    let mode: "numbered" | "author-year" | undefined;

    for (const fragment of fragments) {
      if (/^(appendix|supplementary|acknowledg)/i.test(fragment.text) && blocks.length > 2) break;
      const number = fragment.text.match(NUMBERED);
      const authorYear = AUTHOR_YEAR.test(fragment.text);
      const starts = number || (mode !== "numbered" && authorYear);
      if (starts) {
        if (current) blocks.push(current);
        mode = number ? "numbered" : "author-year";
        current = { raw: fragment.text, fragments: [fragment], index: number ? Number(number[1] || number[2]) : undefined };
      } else if (current) {
        current.raw += " " + fragment.text;
        current.fragments.push(fragment);
      }
      if (blocks.length >= 500) break;
    }
    if (current) blocks.push(current);
    return blocks.filter(block => block.raw.length >= 20);
  }
}
