import type { MatchResult, ReferenceBlock } from "../core/types";

interface IndexedPage {
  page: HTMLElement;
  pageIndex: number;
  spans: HTMLElement[];
  text: string;
  offsets: Array<{ start: number; end: number }>;
  searchableStart: number;
  searchableEnd: number;
  compact: { text: string; offsets: number[] };
}

export class ReferenceOverlay {
  private static readonly styleID = "reference-linker-style";
  private pages: IndexedPage[] = [];
  private hits = new WeakMap<Element, MatchResult>();
  private claimedElements = new WeakSet<Element>();
  private renderedReferences = new Set<string>();
  private readonly clickHandler = (event: Event) => {
    const element = event.target instanceof this.doc.defaultView!.Element
      ? event.target.closest(".reference-linker-hit")
      : null;
    const match = element ? this.hits.get(element) : undefined;
    if (!match) return;
    event.preventDefault();
    event.stopPropagation();
    this.onOpen(match);
  };

  constructor(private readonly doc: Document, private readonly onOpen: (match: MatchResult) => void) {
    this.installStyle();
    this.doc.addEventListener("click", this.clickHandler, true);
  }

  clear(): void {
    this.doc.querySelectorAll(".reference-linker-hit").forEach(node => node.classList.remove("reference-linker-hit"));
    this.doc.querySelectorAll(".reference-linker-badge").forEach(node => node.remove());
    this.hits = new WeakMap<Element, MatchResult>();
    this.claimedElements = new WeakSet<Element>();
    this.renderedReferences.clear();
  }

  linkCount(): number {
    return this.doc.querySelectorAll(".reference-linker-badge").length;
  }

  render(reference: ReferenceBlock, match: MatchResult, referenceKey: string): boolean {
    if (this.renderedReferences.has(referenceKey)
      || reference.fragments.some(fragment => this.claimedElements.has(fragment.element))) return false;
    const anchor = reference.fragments.at(-1)?.element;
    const page = anchor?.closest<HTMLElement>(".page");
    if (!anchor || !page) return false;

    for (const fragment of reference.fragments) {
      this.claimedElements.add(fragment.element);
      fragment.element.classList.add("reference-linker-hit");
      this.hits.set(fragment.element, match);
    }

    const pageRect = page.getBoundingClientRect();
    const rect = anchor.getBoundingClientRect();
    const badge = this.doc.createElement("button");
    badge.className = "reference-linker-badge";
    badge.type = "button";
    badge.textContent = match.record.pdfAttachmentID ? "↗ PDF" : "↗ Item";
    badge.title = `${match.record.title}\nMatched by ${match.method}`;
    badge.style.left = `${Math.min(rect.right - pageRect.left + 6, pageRect.width - 54)}px`;
    badge.style.top = `${rect.top - pageRect.top}px`;
    badge.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      this.onOpen(match);
    });
    page.append(badge);
    this.renderedReferences.add(referenceKey);
    return true;
  }

  indexPages(startPage: number, endPage: number, startHeading?: string, endHeading?: string): string {
    this.pages = [];
    const sectionText: string[] = [];
    for (const page of this.doc.querySelectorAll<HTMLElement>(".page")) {
      const pageIndex = (Number(page.dataset.pageNumber) || 1) - 1;
      if (pageIndex < startPage || pageIndex > endPage) continue;
      const spans = Array.from(page.querySelectorAll<HTMLElement>(".textLayer span"));
      if (!spans.length) continue;
      const joined = this.joinSpans(spans);
      let searchableStart = 0;
      let searchableEnd = joined.text.length;
      if (pageIndex === startPage && startHeading) {
        const headingAt = this.findHeading(joined.text, startHeading, 0);
        if (headingAt >= 0) searchableStart = headingAt + startHeading.length;
      }
      if (pageIndex === endPage && endHeading) {
        const headingAt = this.findHeading(joined.text, endHeading, searchableStart);
        if (headingAt >= 0) searchableEnd = headingAt;
      }
      const searchableText = joined.text.slice(searchableStart, searchableEnd);
      this.pages.push({
        page,
        pageIndex,
        spans,
        text: joined.text,
        offsets: joined.offsets,
        searchableStart,
        searchableEnd,
        compact: this.compactText(searchableText)
      });
      sectionText.push(searchableText);
    }
    return sectionText.join(" ");
  }

  renderIndexed(index: number, match: MatchResult, referenceKey = `index:${index}`): boolean {
    for (const { text, offsets, spans, pageIndex, searchableStart, searchableEnd } of this.pages) {
      const markers = [...text.matchAll(/\[\s*(\d{1,4})\s*\]/g)];
      const markerIndex = markers.findIndex(marker => Number(marker[1]) === index);
      if (markerIndex < 0) continue;
      const start = markers[markerIndex]!.index!;
      if (start < searchableStart || start >= searchableEnd) continue;
      const end = Math.min(markers[markerIndex + 1]?.index ?? searchableEnd, searchableEnd);
      const first = offsets.findIndex(offset => offset.end > start);
      let last = offsets.findIndex(offset => offset.start >= end);
      if (first < 0) continue;
      if (last < 0) last = offsets.length;
      const fragments = spans.slice(first, last).map((element, order) => ({ text: element.textContent || "", element, page: pageIndex + 1, order }));
      if (!fragments.length) continue;
      return this.render({ raw: "", fragments, index }, match, referenceKey);
    }
    return false;
  }

  renderTitle(title: string, match: MatchResult, referenceKey = `title:${title}`): boolean {
    const target = this.compactText(title).text;
    if (target.length < 12) return false;
    for (const { compact, searchableStart, offsets, spans, pageIndex } of this.pages) {
      let from = 0;
      while (from <= compact.text.length - target.length) {
        const found = this.findCompactText(compact.text, target, from);
        if (!found) break;
        const { start: compactStart, end: compactEnd } = found;
        const start = searchableStart + compact.offsets[compactStart]!;
        const end = searchableStart + compact.offsets[compactEnd - 1]! + 1;
        const first = offsets.findIndex(offset => offset.end > start);
        let last = offsets.findIndex(offset => offset.start >= end);
        if (first >= 0) {
          if (last < 0) last = spans.length;
          const fragments = spans.slice(first, last).map((element, order) => ({
            text: element.textContent || "", element, page: pageIndex + 1, order
          }));
          if (fragments.length && this.render({ raw: title, fragments }, match, referenceKey)) return true;
        }
        from = compactStart + 1;
      }
    }
    return false;
  }

  private findCompactText(source: string, target: string, from: number): { start: number; end: number } | undefined {
    const exact = source.indexOf(target, from);
    if (exact >= 0) return { start: exact, end: exact + target.length };
    for (let start = from; start < source.length; start++) {
      let sourceIndex = start;
      let targetIndex = 0;
      while (sourceIndex < source.length && targetIndex < target.length) {
        if (source[sourceIndex] === target[targetIndex]) {
          sourceIndex++;
          targetIndex++;
          continue;
        }
        const insertedNumber = source.slice(sourceIndex).match(/^\d{1,4}/)?.[0];
        if (!insertedNumber || /\d/.test(target[targetIndex]!)) break;
        sourceIndex += insertedNumber.length;
      }
      if (targetIndex === target.length) return { start, end: sourceIndex };
    }
    return undefined;
  }

  destroy(): void {
    this.clear();
    this.doc.removeEventListener("click", this.clickHandler, true);
    this.doc.getElementById(ReferenceOverlay.styleID)?.remove();
  }

  private installStyle(): void {
    if (this.doc.getElementById(ReferenceOverlay.styleID)) return;
    const style = this.doc.createElement("style");
    style.id = ReferenceOverlay.styleID;
    style.textContent = `
      .reference-linker-hit { background: rgba(255, 210, 40, .34) !important; border-radius: 2px; cursor: pointer; }
      .reference-linker-badge { position: absolute; z-index: 50; border: 1px solid rgba(90,70,0,.35); border-radius: 4px; padding: 1px 5px; background: #fff3a6; color: #342b00; font: 600 10px/16px system-ui, sans-serif; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
      .reference-linker-badge:hover { background: #ffe35c; }
    `;
    (this.doc.head || this.doc.documentElement).append(style);
  }

  private joinSpans(spans: HTMLElement[]): { text: string; offsets: Array<{ start: number; end: number }> } {
    let text = "";
    const offsets: Array<{ start: number; end: number }> = [];
    for (const span of spans) {
      if (text) text += " ";
      const start = text.length;
      text += span.textContent || "";
      offsets.push({ start, end: text.length });
    }
    return { text, offsets };
  }

  private findHeading(text: string, heading: string, from: number): number {
    const words = heading.trim().split(/\s+/).map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const match = new RegExp(words.join("\\s+"), "i").exec(text.slice(from));
    return match ? from + match.index : -1;
  }

  private compactText(value: string): { text: string; offsets: number[] } {
    let text = "";
    const offsets: number[] = [];
    for (let i = 0; i < value.length; i++) {
      const normalized = value[i]!.normalize("NFKD").toLowerCase().replace(/\p{M}/gu, "");
      for (const character of normalized) {
        if (!/[\p{L}\p{N}]/u.test(character)) continue;
        text += character;
        offsets.push(i);
      }
    }
    return { text, offsets };
  }
}
