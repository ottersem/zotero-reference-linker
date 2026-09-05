import { CitationParser } from "../core/CitationParser";
import { LibraryMatcher } from "../core/LibraryMatcher";
import { PdfSectionExtractor, type PdfDocument } from "../core/PdfSectionExtractor";
import type { ReferenceSection } from "../core/types";
import { ReferenceOverlay } from "./ReferenceOverlay";

interface ReaderState {
  outerObserver?: MutationObserver;
  viewerObserver?: MutationObserver;
  viewerDocument?: Document;
  overlay?: ReferenceOverlay;
  overlayDocument?: Document;
  timer?: number;
  scanning: boolean;
  fingerprint?: string;
  lastMatched?: number;
  summary?: HTMLElement;
  summaryTimer?: number;
  sectionPromise?: Promise<ReferenceSection | undefined>;
  unloadHandler?: () => void;
}

export class ReaderIntegration {
  private readonly states = new WeakMap<ZoteroReader, ReaderState>();
  private readonly readers = new Set<ZoteroReader>();
  private readonly parser = new CitationParser();
  private readonly sectionExtractor = new PdfSectionExtractor();
  private readonly matcherCache = new Map<number, Promise<LibraryMatcher>>();
  private toolbarHandler = (event: ReaderEvent) => this.onToolbar(event);

  constructor(private readonly zotero: ZoteroAPI, private readonly pluginID: string) {}

  start(): void {
    this.zotero.Reader.registerEventListener("renderToolbar", this.toolbarHandler, this.pluginID);
  }

  stop(): void {
    this.zotero.Reader.unregisterEventListener("renderToolbar", this.toolbarHandler);
    for (const reader of this.readers) this.destroyReader(reader);
    this.readers.clear();
  }

  private onToolbar({ reader, doc, append }: ReaderEvent): void {
    if (!doc || !append) return;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "toolbar-button";
    button.title = "Scan References and link items in your library";
    button.setAttribute("aria-label", "Link library references");
    button.textContent = "Ref ↗";
    this.installToolbarStyle(doc);
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.textContent = "Scanning…";
      button.disabled = true;
      try {
        await this.scan(reader, true, true);
      } catch (error) {
        this.zotero.logError(error);
        button.title = error instanceof Error ? error.message : String(error);
      } finally {
        button.textContent = original;
        button.disabled = false;
      }
    });
    append(button);
    const summary = this.createSummary(doc, button);
    (doc.body || doc.documentElement).append(summary);
    const state = this.states.get(reader) || { scanning: false };
    if (state.summaryTimer) state.summary?.ownerDocument.defaultView?.clearTimeout(state.summaryTimer);
    state.summary?.remove();
    state.summary = summary;
    state.summaryTimer = undefined;
    this.states.set(reader, state);
    this.attach(reader);
  }

  private attach(reader: ZoteroReader): void {
    this.readers.add(reader);
    const state = this.states.get(reader) || { scanning: false };
    this.states.set(reader, state);
    const win = reader._iframeWindow;
    if (!win?.document?.documentElement || state.outerObserver) return;
    const Observer = (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
    const observer = new Observer(() => {
      const viewer = this.getViewerDocument(reader);
      if (viewer && viewer !== state.viewerDocument) {
        this.observeViewer(reader, viewer);
        this.scheduleScan(reader);
      }
    });
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    state.outerObserver = observer;
    if (!state.unloadHandler) {
      state.unloadHandler = () => {
        this.destroyReader(reader);
        this.readers.delete(reader);
      };
      win.addEventListener("unload", state.unloadHandler, { once: true });
    }
    this.scheduleScan(reader, 1200);
  }

  private scheduleScan(reader: ZoteroReader, delay = 500): void {
    const state = this.states.get(reader);
    const win = reader._iframeWindow;
    if (!state || !win) return;
    if (state.timer) win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => void this.scan(reader, false), delay);
  }

  private async scan(reader: ZoteroReader, reportEmpty: boolean, force = false): Promise<number | undefined> {
    const state = this.states.get(reader);
    const doc = this.getViewerDocument(reader);
    if (!state || !doc || state.scanning) return undefined;
    this.observeViewer(reader, doc);
    const fingerprint = this.pageFingerprint(doc);
    if (!force && state.fingerprint === fingerprint) return state.lastMatched;
    state.fingerprint = fingerprint;
    state.scanning = true;
    try {
      const section = await this.getReferenceSection(reader, state);
      if (!section) {
        if (reportEmpty) this.zotero.debug("Reference Linker: no rendered References section found. Scroll to the references pages and retry.");
        return undefined;
      }
      const attachment = this.getAttachment(reader);
      if (!attachment) return undefined;
      const currentItemID = typeof attachment.parentID === "number" ? attachment.parentID : undefined;
      const matcher = await this.getMatcher(attachment.libraryID);
      if (!state.overlay || state.overlayDocument !== doc) {
        state.overlay?.destroy();
        state.overlay = new ReferenceOverlay(
          doc,
          match => void this.open(match.record.item.id, match.record.pdfAttachmentID),
          url => this.zotero.launchURL(url)
        );
        state.overlayDocument = doc;
      }
      state.overlay.clear();
      state.overlay.indexPages(section.startPage, section.endPage, section.startHeading, section.endHeading);
      let matchedItems = 0;
      let ambiguousItems = 0;
      let unmatchedItems = 0;
      for (const [position, reference] of section.references.entries()) {
        const citation = this.parser.parse(reference);
        const outcome = matcher.matchWithOutcome(citation);
        const match = outcome.match;
        const referenceKey = reference.index == null ? `reference:${position}` : `index:${reference.index}`;
        if (!match) {
          if (outcome.ambiguous) ambiguousItems++;
          else unmatchedItems++;
          if (reference.index != null) {
            state.overlay.renderIndexedUnmatched(reference.index, citation, referenceKey);
          } else {
            state.overlay.renderTitleUnmatched(citation.title || reference.raw, citation, referenceKey);
          }
          continue;
        }
        matchedItems++;
        if (match.record.item.id === currentItemID) continue;
        reference.index != null
          ? state.overlay.renderIndexed(reference.index, match, referenceKey)
          : state.overlay.renderTitle(citation.title || reference.raw, match, referenceKey);
      }
      const linked = state.overlay.linkCount();
      this.updateSummary(state, {
        scanned: section.references.length,
        matched: matchedItems,
        ambiguous: ambiguousItems,
        unmatched: unmatchedItems
      });
      this.zotero.debug(`Reference Linker: ${linked} links rendered; ${matchedItems} library items matched; source=${section.source}`);
      state.lastMatched = linked;
      return linked;
    } catch (error) {
      this.zotero.logError(error);
      throw error;
    } finally {
      state.scanning = false;
    }
  }

  private getReferenceSection(reader: ZoteroReader, state: ReaderState): Promise<ReferenceSection | undefined> {
    if (!state.sectionPromise) {
      const pdf = this.getPdfDocument(reader);
      if (!pdf) return Promise.resolve(undefined);
      state.sectionPromise = this.sectionExtractor.extract(pdf);
      state.sectionPromise.catch(() => { state.sectionPromise = undefined; });
    }
    return state.sectionPromise;
  }

  private installToolbarStyle(doc: Document): void {
    if (doc.getElementById("reference-linker-toolbar-style")) return;
    const style = doc.createElement("style");
    style.id = "reference-linker-toolbar-style";
    style.textContent = `
      .reference-linker-summary {
        position: fixed; right: 0; z-index: 1000; display: none; min-width: 128px;
        box-sizing: border-box; padding: 8px 10px; border-radius: 6px;
        background: rgba(24, 119, 242, .5); color: white;
        font: 600 12px/1.55 system-ui, sans-serif; white-space: pre;
        pointer-events: none; box-shadow: 0 2px 8px rgba(0, 0, 0, .18);
      }
    `;
    (doc.head || doc.documentElement).append(style);
  }

  private createSummary(doc: Document, button: HTMLElement): HTMLElement {
    const summary = doc.createElement("div");
    summary.className = "reference-linker-summary";
    summary.setAttribute("role", "status");
    summary.setAttribute("aria-live", "polite");
    const position = () => {
      const rect = button.getBoundingClientRect();
      summary.style.top = `${rect.bottom + 6}px`;
      summary.style.right = "0";
    };
    position();
    return summary;
  }

  private updateSummary(state: ReaderState, counts: { scanned: number; matched: number; ambiguous: number; unmatched: number }): void {
    if (!state.summary) return;
    state.summary.textContent = `scanned : ${counts.scanned}\nmatched : ${counts.matched}\nambiguous : ${counts.ambiguous}\nunmatched : ${counts.unmatched}`;
    state.summary.style.display = "block";
    const summary = state.summary;
    const win = summary.ownerDocument.defaultView;
    if (!win) return;
    if (state.summaryTimer) win.clearTimeout(state.summaryTimer);
    state.summaryTimer = win.setTimeout(() => {
      if (state.summary === summary) summary.style.display = "none";
      state.summaryTimer = undefined;
    }, 30_000);
  }

  private pageFingerprint(doc: Document): string {
    return Array.from(doc.querySelectorAll<HTMLElement>(".page")).map(page => {
      const spans = page.querySelectorAll<HTMLElement>(".textLayer span");
      const first = spans.item(0)?.textContent || "";
      const last = spans.item(spans.length - 1)?.textContent || "";
      return `${page.dataset.pageNumber || "?"}:${spans.length}:${first}:${last}`;
    }).join("|");
  }

  private getPdfDocument(reader: ZoteroReader): PdfDocument | undefined {
    const internal = (reader as ZoteroReader & {
      _internalReader?: { _primaryView?: { _iframeWindow?: Window & { PDFViewerApplication?: { pdfDocument?: PdfDocument } } } };
    })._internalReader;
    return internal?._primaryView?._iframeWindow?.PDFViewerApplication?.pdfDocument;
  }

  private getMatcher(libraryID: number): Promise<LibraryMatcher> {
    let pending = this.matcherCache.get(libraryID);
    if (!pending) {
      pending = (async () => {
        const matcher = new LibraryMatcher(this.zotero);
        await matcher.index(libraryID);
        return matcher;
      })();
      this.matcherCache.set(libraryID, pending);
      pending.catch(() => this.matcherCache.delete(libraryID));
    }
    return pending;
  }

  private getViewerDocument(reader: ZoteroReader): Document | undefined {
    const outer = reader._iframeWindow?.document;
    if (!outer) return undefined;
    const iframe = outer.querySelector<HTMLIFrameElement>("#primary-view > iframe, .primary-view > iframe");
    return iframe?.contentDocument || undefined;
  }

  private observeViewer(reader: ZoteroReader, doc: Document): void {
    const state = this.states.get(reader);
    const win = doc.defaultView;
    if (!state || !win || state.viewerDocument === doc) return;
    state.viewerObserver?.disconnect();
    const Observer = (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
    state.viewerObserver = new Observer(mutations => {
      const changedReaderContent = mutations.some(mutation =>
        Array.from(mutation.addedNodes).some(node => !this.isOwnNode(node))
        || Array.from(mutation.removedNodes).some(node => !this.isOwnNode(node))
      );
      if (changedReaderContent) this.scheduleScan(reader);
    });
    state.viewerObserver.observe(doc.documentElement, { childList: true, subtree: true });
    state.viewerDocument = doc;
  }

  private isOwnNode(node: Node): boolean {
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    return element.matches(".reference-linker-badge, .reference-linker-menu, #reference-linker-style")
      || Boolean(element.closest(".reference-linker-badge, .reference-linker-menu"));
  }

  private getAttachment(reader: ZoteroReader): ZoteroItem | undefined {
    const item = reader._item || (reader.itemID ? this.zotero.Items.get(reader.itemID) : false);
    return item && item.isAttachment() ? item : undefined;
  }

  private async open(itemID: number, pdfAttachmentID?: number): Promise<void> {
    if (pdfAttachmentID) {
      await this.zotero.Reader.open(pdfAttachmentID);
      return;
    }
    const pane = this.zotero.getMainWindow().ZoteroPane;
    await pane?.selectItem(itemID);
  }

  private destroyReader(reader: ZoteroReader): void {
    const state = this.states.get(reader);
    state?.outerObserver?.disconnect();
    state?.viewerObserver?.disconnect();
    state?.overlay?.destroy();
    state?.summary?.remove();
    const win = reader._iframeWindow;
    if (state?.timer && win) win.clearTimeout(state.timer);
    if (state?.summaryTimer) state.summary?.ownerDocument.defaultView?.clearTimeout(state.summaryTimer);
    if (state?.unloadHandler && win) win.removeEventListener("unload", state.unloadHandler);
  }
}
