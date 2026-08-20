import { CitationParser } from "../core/CitationParser";
import { LibraryMatcher } from "../core/LibraryMatcher";
import { ReferenceExtractor } from "../core/ReferenceExtractor";
import { ReferenceOverlay } from "./ReferenceOverlay";

interface ReaderState {
  observer?: MutationObserver;
  overlay?: ReferenceOverlay;
  timer?: number;
  scanning: boolean;
}

export class ReaderIntegration {
  private readonly states = new WeakMap<ZoteroReader, ReaderState>();
  private readonly readers = new Set<ZoteroReader>();
  private readonly extractor = new ReferenceExtractor();
  private readonly parser = new CitationParser();
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
    button.addEventListener("click", () => void this.scan(reader, true));
    append(button);
    this.attach(reader);
  }

  private attach(reader: ZoteroReader): void {
    this.readers.add(reader);
    const state = this.states.get(reader) || { scanning: false };
    this.states.set(reader, state);
    const win = reader._iframeWindow;
    if (!win?.document?.documentElement || state.observer) return;
    state.overlay = new ReferenceOverlay(win.document, match => void this.open(match.record.item.id, match.record.pdfAttachmentID));
    const Observer = (win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver;
    const observer = new Observer(() => this.scheduleScan(reader));
    observer.observe(win.document.documentElement, { childList: true, subtree: true });
    state.observer = observer;
    this.scheduleScan(reader, 1200);
  }

  private scheduleScan(reader: ZoteroReader, delay = 500): void {
    const state = this.states.get(reader);
    const win = reader._iframeWindow;
    if (!state || !win) return;
    if (state.timer) win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => void this.scan(reader, false), delay);
  }

  private async scan(reader: ZoteroReader, reportEmpty: boolean): Promise<void> {
    const state = this.states.get(reader);
    const doc = reader._iframeWindow?.document;
    if (!state || !doc || state.scanning) return;
    state.scanning = true;
    try {
      const references = this.extractor.extract(doc);
      if (!references.length) {
        if (reportEmpty) this.zotero.debug("Reference Linker: no rendered References section found. Scroll to the references pages and retry.");
        return;
      }
      const attachment = this.getAttachment(reader);
      if (!attachment) return;
      const matcher = new LibraryMatcher(this.zotero);
      await matcher.index(attachment.libraryID);
      state.overlay ||= new ReferenceOverlay(doc, match => void this.open(match.record.item.id, match.record.pdfAttachmentID));
      state.overlay.clear();
      let matched = 0;
      for (const reference of references) {
        const match = matcher.match(this.parser.parse(reference));
        if (!match) continue;
        state.overlay.render(reference, match);
        matched++;
      }
      this.zotero.debug(`Reference Linker: matched ${matched}/${references.length} rendered references`);
    } catch (error) {
      this.zotero.logError(error);
    } finally {
      state.scanning = false;
    }
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
    state?.observer?.disconnect();
    state?.overlay?.destroy();
    const win = reader._iframeWindow;
    if (state?.timer && win) win.clearTimeout(state.timer);
  }
}
