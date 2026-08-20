import type { MatchResult, ReferenceBlock } from "../core/types";

export class ReferenceOverlay {
  private static readonly styleID = "reference-linker-style";

  constructor(private readonly doc: Document, private readonly onOpen: (match: MatchResult) => void) {
    this.installStyle();
  }

  clear(): void {
    this.doc.querySelectorAll(".reference-linker-hit").forEach(node => node.classList.remove("reference-linker-hit"));
    this.doc.querySelectorAll(".reference-linker-badge").forEach(node => node.remove());
  }

  render(reference: ReferenceBlock, match: MatchResult): void {
    for (const fragment of reference.fragments) fragment.element.classList.add("reference-linker-hit");
    const anchor = reference.fragments.at(-1)?.element;
    const page = anchor?.closest<HTMLElement>(".page");
    if (!anchor || !page) return;

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
  }

  destroy(): void {
    this.clear();
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
}
