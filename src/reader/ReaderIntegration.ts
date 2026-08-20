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
    button.addEventListener("click", async () => {
      const original = button.textContent;
      button.textContent = "Scanning…";
      button.disabled = true;
      try {
        const result = await this.scan(reader, true, true);
        button.textContent = result == null ? "No refs" : `${result} linked`;
      } catch (error) {
        this.zotero.logError(error);
        button.textContent = "Scan error";
        button.title = error instanceof Error ? error.message : String(error);
      }
      button.disabled = false;
      reader._iframeWindow?.setTimeout(() => { button.textContent = original; }, 2500);
    });
    append(button);
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
        state.overlay = new ReferenceOverlay(doc, match => void this.open(match.record.item.id, match.record.pdfAttachmentID));
        state.overlayDocument = doc;
      }
      state.overlay.clear();
      const sectionText = state.overlay.indexPages(section.startPage, section.endPage, section.startHeading, section.endHeading);
      let matchedItems = 0;
      const renderedItems = new Set<number>();
      for (const reference of section.references) {
        const match = matcher.match(this.parser.parse(reference));
        if (!match || match.record.item.id === currentItemID) continue;
        let rendered = false;
        if (reference.index != null) {
          rendered = state.overlay.renderIndexed(reference.index, match);
        }
        if (rendered) {
          matchedItems++;
          renderedItems.add(match.record.item.id);
        }
      }
      for (const match of matcher.findTitlesInText(sectionText)) {
        if (match.record.item.id === currentItemID || renderedItems.has(match.record.item.id)) continue;
        if (state.overlay.renderTitle(match.record.title, match)) {
          matchedItems++;
          renderedItems.add(match.record.item.id);
        }
      }
      const linked = state.overlay.linkCount();
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
    return element.matches(".reference-linker-badge, #reference-linker-style")
      || Boolean(element.closest(".reference-linker-badge"));
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
    const win = reader._iframeWindow;
    if (state?.timer && win) win.clearTimeout(state.timer);
    if (state?.unloadHandler && win) win.removeEventListener("unload", state.unloadHandler);
  }
}
