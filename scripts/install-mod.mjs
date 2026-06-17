import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "mods", "agent-halo.js");
const target = join(homedir(), ".letta", "mods", "agent-halo.js");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`Installed ${source} -> ${target}`);
console.log("Run /reload in Letta Code to activate the mod.");
