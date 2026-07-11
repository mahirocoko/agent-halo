import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "mods", "agent-halo.js");
const target = join(homedir(), ".letta", "mods", "agent-halo.js");
const hookSource = join(root, "hooks", "agent-halo-hook.mjs");
const hookTarget = join(homedir(), ".letta", "hooks", "agent-halo-hook.mjs");

await mkdir(dirname(target), { recursive: true });
await mkdir(dirname(hookTarget), { recursive: true });
await copyFile(source, target);
await copyFile(hookSource, hookTarget);

console.log(`Installed ${source} -> ${target}`);
console.log(`Installed ${hookSource} -> ${hookTarget}`);
console.log("Generic PermissionRequest relay is optional and is not added to global Letta settings automatically.");
console.log("Run /reload in Letta Code to activate the mod.");
