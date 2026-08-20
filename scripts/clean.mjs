import { rm } from "node:fs/promises";
await rm(new URL("../build", import.meta.url), { recursive: true, force: true });
