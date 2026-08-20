import { ReaderIntegration } from "./reader/ReaderIntegration";

let integration: ReaderIntegration | undefined;

export async function startup({ pluginID, Zotero }: { pluginID: string; rootURI: string; Zotero: ZoteroAPI }): Promise<void> {
  integration = new ReaderIntegration(Zotero, pluginID);
  integration.start();
  Zotero.debug("Reference Linker started");
}

export async function shutdown(): Promise<void> {
  integration?.stop();
  integration = undefined;
}
