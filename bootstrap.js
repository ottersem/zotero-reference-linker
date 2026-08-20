/* global Services, Zotero */
var ReferenceLinkerBootstrap;

function install() {}

async function startup({ id, rootURI }) {
  Services.scriptloader.loadSubScript(rootURI + "content/reference-linker.js");
  ReferenceLinkerBootstrap = globalThis.ReferenceLinker;
  await ReferenceLinkerBootstrap.startup({ pluginID: id, rootURI, Zotero });
}

async function shutdown(_data, reason) {
  if (reason === APP_SHUTDOWN) return;
  await ReferenceLinkerBootstrap?.shutdown();
  ReferenceLinkerBootstrap = undefined;
  delete globalThis.ReferenceLinker;
}

function uninstall() {}
