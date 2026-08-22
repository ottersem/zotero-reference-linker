import { build } from "esbuild";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = join(root, "build");
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const xpi = join(root, `${basename(root)}-${manifest.version}.xpi`);
await Promise.all([
  rm(out, { recursive: true, force: true }),
  rm(xpi, { force: true })
]);
await mkdir(join(out, "content"), { recursive: true });
await build({
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(out, "content/reference-linker.js"),
  bundle: true,
  format: "iife",
  globalName: "ReferenceLinker",
  platform: "browser",
  target: "firefox140",
  sourcemap: true,
  legalComments: "none"
});
await Promise.all([
  cp(join(root, "bootstrap.js"), join(out, "bootstrap.js")),
  cp(join(root, "manifest.json"), join(out, "manifest.json")),
  cp(join(root, "README.md"), join(out, "README.md")),
  cp(join(root, "icon.png"), join(out, "icon.png")),
  cp(join(root, "icon@2x.png"), join(out, "icon@2x.png")),
]);
try { execFileSync("zip", ["-qr", xpi, "."], { cwd: out }); }
catch { console.warn("zip command unavailable; build folder is still ready to install."); }
console.log(`Built ${out}`);
console.log(`Packaged ${xpi}`);
