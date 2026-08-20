export function normalizeDOI(value: string): string | undefined {
  const match = value.match(/10\.\d{4,9}\/[-._;()/:a-z0-9]+/i);
  return match?.[0].replace(/[.,;:)\]}]+$/g, "").toLowerCase();
}

export function normalizeArxiv(value: string): string | undefined {
  const match = value.match(/(?:arxiv\s*:\s*)?((?:[a-z-]+\/\d{7})|(?:\d{4}\.\d{4,5}))(?:v\d+)?/i);
  return match?.[1]?.toLowerCase();
}

export function normalizeTitle(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function surname(value?: string): string | undefined {
  if (!value) return undefined;
  return normalizeTitle(value).split(" ").filter(Boolean).at(-1);
}

export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokens = (value: string) => value.split(" ")
    .filter(word => word.length > 2)
    .map(word => word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return 0;
  let intersection = 0;
  for (const word of aa) if (bb.has(word)) intersection++;
  const jaccard = intersection / (aa.size + bb.size - intersection);
  const containment = intersection / Math.min(aa.size, bb.size);
  return 0.55 * containment + 0.45 * jaccard;
}
