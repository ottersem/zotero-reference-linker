declare const Zotero: ZoteroAPI;

interface ZoteroItem {
  id: number;
  key: string;
  libraryID: number;
  parentID?: number | false;
  itemTypeID: number;
  getField(field: string): string;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorTypeID?: number }>;
  getAttachments(): number[];
  isRegularItem(): boolean;
  isAttachment(): boolean;
  attachmentContentType?: string;
}

interface ZoteroReader {
  itemID?: number;
  _item?: ZoteroItem;
  _iframeWindow?: Window;
}

interface ZoteroAPI {
  debug(message: unknown, level?: number): void;
  logError(error: unknown): void;
  getMainWindow(): Window & { ZoteroPane?: { viewAttachment(id: number): Promise<void> | void; selectItem(id: number): Promise<void> | void } };
  Items: {
    get(id: number): ZoteroItem | false;
    getAll(libraryID: number, onlyTopLevel?: boolean, includeDeleted?: boolean): Promise<ZoteroItem[]>;
  };
  ItemTypes?: {
    getName(itemTypeID: number): string;
  };
  Reader: {
    registerEventListener(type: string, handler: (event: ReaderEvent) => void, pluginID: string): void;
    unregisterEventListener(type: string, handler: (event: ReaderEvent) => void): void;
    open(itemID: number): Promise<unknown>;
  };
}

interface ReaderEvent {
  reader: ZoteroReader;
  doc?: Document;
  append?: (node: Node) => void;
}
