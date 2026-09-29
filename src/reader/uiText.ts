/** Keep reader controls in the selected Zotero language without affecting PDF parsing. */
export function uiText(english: string, serbianLatin: string): string {
  const globals = globalThis as unknown as {
    Zotero?: { locale?: string };
    Services?: { locale?: { appLocaleAsBCP47?: string } };
  };
  const locale = String(globals.Zotero?.locale || globals.Services?.locale?.appLocaleAsBCP47 || "")
    .replace(/_/g, "-")
    .toLowerCase();
  return locale.startsWith("sr-latn") ? serbianLatin : english;
}
