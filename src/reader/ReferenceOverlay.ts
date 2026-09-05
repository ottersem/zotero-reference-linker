import type { MatchResult, ParsedCitation, ReferenceBlock } from "../core/types";

export type UnmatchedReferenceAction =
  | { kind: "open"; label: "Open DOI" | "Search"; value: string }
  | { kind: "copy"; label: "Copy title"; value: string };

export function unmatchedReferenceActions(citation: ParsedCitation): UnmatchedReferenceAction[] {
  const actions: UnmatchedReferenceAction[] = [];
  if (citation.doi) actions.push({ kind: "open", label: "Open DOI", value: `https://doi.org/${citation.doi}` });
  if (citation.title) {
    actions.push({
      kind: "open",
      label: "Search",
      value: `https://scholar.google.com/scholar?q=${encodeURIComponent(citation.title)}`
    });
    actions.push({ kind: "copy", label: "Copy title", value: citation.title });
  }
  return actions;
}

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

export function findIndexedReferenceMarkers(text: string): Array<{ index: number; start: number }> {
  return [...text.matchAll(/\[\s*(\d{1,4})\s*\]|(?:^|\s)(\d{1,4})[.)](?=\s)/g)].map(match => ({
    index: Number(match[1] || match[2]),
    start: match.index! + (match[2] ? match[0].search(/\d/) : 0)
  }));
}

export class ReferenceOverlay {
  private static readonly styleID = "reference-linker-style";
  private pages: IndexedPage[] = [];
  private hits = new WeakMap<Element, MatchResult>();
  private unmatched = new WeakMap<Element, ParsedCitation>();
  private claimedElements = new WeakSet<Element>();
  private renderedReferences = new Set<string>();
  private menu?: HTMLElement;
  private readonly clickHandler = (event: Event) => {
    const target = event.target instanceof this.doc.defaultView!.Element ? event.target : null;
    if (target?.closest(".reference-linker-menu")) return;
    const hit = target?.closest(".reference-linker-hit");
    const match = hit ? this.hits.get(hit) : undefined;
    if (match) {
      event.preventDefault();
      event.stopPropagation();
      this.closeMenu();
      this.onOpen(match);
      return;
    }
    const unmatched = target?.closest(".reference-linker-unmatched");
    const citation = unmatched ? this.unmatched.get(unmatched) : undefined;
    if (!unmatched || !citation || !unmatchedReferenceActions(citation).length) {
      this.closeMenu();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.showMenu(unmatched, citation);
  };

  constructor(
    private readonly doc: Document,
    private readonly onOpen: (match: MatchResult) => void,
    private readonly onOpenURL: (url: string) => void = url => { doc.defaultView?.open(url, "_blank", "noopener"); },
    private readonly onCopyTitle?: (title: string) => void | Promise<void>
  ) {
    this.installStyle();
    this.doc.addEventListener("click", this.clickHandler, true);
  }

  clear(): void {
    this.doc.querySelectorAll(".reference-linker-hit, .reference-linker-unmatched, .reference-linker-actionable").forEach(node => {
      node.classList.remove("reference-linker-hit", "reference-linker-unmatched", "reference-linker-actionable");
    });
    this.doc.querySelectorAll(".reference-linker-badge").forEach(node => node.remove());
    this.closeMenu();
    this.hits = new WeakMap<Element, MatchResult>();
    this.unmatched = new WeakMap<Element, ParsedCitation>();
    this.claimedElements = new WeakSet<Element>();
    this.renderedReferences.clear();
  }

  linkCount(): number {
    return this.doc.querySelectorAll(".reference-linker-badge").length;
  }

  private render(reference: ReferenceBlock, match: MatchResult | undefined, referenceKey: string, citation?: ParsedCitation): boolean {
    if (this.renderedReferences.has(referenceKey)
      || reference.fragments.some(fragment => this.claimedElements.has(fragment.element))) return false;
    const anchor = reference.fragments.at(-1)?.element;
    const page = anchor?.closest<HTMLElement>(".page");
    if (!anchor || !page) return false;

    for (const fragment of reference.fragments) {
      this.claimedElements.add(fragment.element);
      fragment.element.classList.add(match ? "reference-linker-hit" : "reference-linker-unmatched");
      if (match) this.hits.set(fragment.element, match);
      else if (citation && unmatchedReferenceActions(citation).length) {
        fragment.element.classList.add("reference-linker-actionable");
        this.unmatched.set(fragment.element, citation);
      }
    }

    this.renderedReferences.add(referenceKey);
    if (!match) return true;

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
    return this.renderIndexedReference(index, match, referenceKey);
  }

  renderIndexedUnmatched(index: number, citation?: ParsedCitation, referenceKey = `index:${index}`): boolean {
    return this.renderIndexedReference(index, undefined, referenceKey, citation);
  }

  private renderIndexedReference(index: number, match: MatchResult | undefined, referenceKey: string, citation?: ParsedCitation): boolean {
    for (const { text, offsets, spans, pageIndex, searchableStart, searchableEnd } of this.pages) {
      const markers = findIndexedReferenceMarkers(text);
      const markerIndex = markers.findIndex(marker => marker.index === index);
      if (markerIndex < 0) continue;
      const start = markers[markerIndex]!.start;
      if (start < searchableStart || start >= searchableEnd) continue;
      const end = Math.min(markers[markerIndex + 1]?.start ?? searchableEnd, searchableEnd);
      const first = offsets.findIndex(offset => offset.end > start);
      let last = offsets.findIndex(offset => offset.start >= end);
      if (first < 0) continue;
      if (last < 0) last = offsets.length;
      const fragments = spans.slice(first, last).map((element, order) => ({ text: element.textContent || "", element, page: pageIndex + 1, order }));
      if (!fragments.length) continue;
      return this.render({ raw: "", fragments, index }, match, referenceKey, citation);
    }
    return false;
  }

  renderTitle(title: string, match: MatchResult, referenceKey = `title:${title}`): boolean {
    return this.renderTitleReference(title, match, referenceKey);
  }

  renderTitleUnmatched(title: string, citation?: ParsedCitation, referenceKey = `title:${title}`): boolean {
    return this.renderTitleReference(title, undefined, referenceKey, citation);
  }

  private renderTitleReference(title: string, match: MatchResult | undefined, referenceKey: string, citation?: ParsedCitation): boolean {
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
          if (fragments.length && this.render({ raw: title, fragments }, match, referenceKey, citation)) return true;
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

  private showMenu(anchor: Element, citation: ParsedCitation): void {
    this.closeMenu();
    const menu = this.doc.createElement("div");
    menu.className = "reference-linker-menu";
    menu.setAttribute("role", "menu");
    for (const action of unmatchedReferenceActions(citation)) {
      const button = this.doc.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.setAttribute("role", "menuitem");
      button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (action.kind === "open") {
          this.onOpenURL(action.value);
          this.closeMenu();
        } else {
          const copying = this.onCopyTitle ? this.onCopyTitle(action.value) : this.copyTitle(action.value);
          void Promise.resolve(copying).then(() => this.closeMenu(), () => this.closeMenu());
        }
      });
      menu.append(button);
    }
    (this.doc.body || this.doc.documentElement).append(menu);
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const width = this.doc.documentElement.clientWidth;
    const height = this.doc.documentElement.clientHeight;
    menu.style.left = `${Math.max(8, Math.min(anchorRect.left, width - menuRect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(anchorRect.bottom + 4, height - menuRect.height - 8))}px`;
    this.menu = menu;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = undefined;
  }

  private copyTitle(title: string): void | Promise<void> {
    const clipboard = this.doc.defaultView?.navigator.clipboard;
    if (clipboard) return clipboard.writeText(title);
    const textarea = this.doc.createElement("textarea");
    textarea.value = title;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    (this.doc.body || this.doc.documentElement).append(textarea);
    textarea.select();
    this.doc.execCommand("copy");
    textarea.remove();
  }

  private installStyle(): void {
    if (this.doc.getElementById(ReferenceOverlay.styleID)) return;
    const style = this.doc.createElement("style");
    style.id = ReferenceOverlay.styleID;
    style.textContent = `
      .reference-linker-hit { background: rgba(255, 210, 40, .34) !important; border-radius: 2px; cursor: pointer; }
      .reference-linker-unmatched { background: rgba(110, 118, 126, .45) !important; border-radius: 2px; }
      .reference-linker-actionable { cursor: pointer; }
      .reference-linker-badge { position: absolute; z-index: 50; border: 1px solid rgba(90,70,0,.35); border-radius: 4px; padding: 1px 5px; background: #fff3a6; color: #342b00; font: 600 10px/16px system-ui, sans-serif; cursor: pointer; box-shadow: 0 1px 2px rgba(0,0,0,.2); }
      .reference-linker-badge:hover { background: #ffe35c; }
      .reference-linker-menu { position: fixed; z-index: 100; display: flex; gap: 4px; padding: 5px; border: 1px solid rgba(0,0,0,.18); border-radius: 7px; background: rgba(255,255,255,.97); box-shadow: 0 3px 12px rgba(0,0,0,.22); }
      .reference-linker-menu button { border: 0; border-radius: 4px; padding: 4px 7px; background: transparent; color: #222; font: 600 11px/16px system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
      .reference-linker-menu button:hover { background: rgba(0,0,0,.08); }
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
