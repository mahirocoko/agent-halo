import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const repoRoot = resolve(import.meta.dirname, "..");
const distRoot = join(repoRoot, "apps/desktop/dist");
const assetRoot = join(distRoot, "assets");

const BUDGETS = {
  cssGzipBytes: 8_750,
  distBytes: 573_055,
  jsGzipBytes: 91_000,
};

const walk = async (directory) => {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await walk(path);
      bytes += child.bytes;
      files += child.files;
    } else {
      bytes += (await stat(path)).size;
      files += 1;
    }
  }
  return { bytes, files };
};

const assets = [];
for (const name of await readdir(assetRoot)) {
  const path = join(assetRoot, name);
  const contents = await readFile(path);
  assets.push({ name, bytes: contents.length, gzipBytes: gzipSync(contents).length });
}

const css = assets.find((asset) => asset.name.endsWith(".css"));
const js = assets.find((asset) => asset.name.endsWith(".js"));
if (!css || !js) throw new Error("desktop build is missing its primary CSS or JavaScript asset");

const dist = await walk(distRoot);
const legacyEntries = [];
const findLegacy = async (directory, relative = "") => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const nextRelative = join(relative, entry.name);
    if (nextRelative.toLowerCase().includes("session-cat")) legacyEntries.push(nextRelative);
    if (entry.isDirectory()) await findLegacy(join(directory, entry.name), nextRelative);
  }
};
await findLegacy(distRoot);

const payload = {
  baselineCommit: "4a5c0f1",
  budgetRevision: "runtime-monitor-v2",
  budgets: BUDGETS,
  current: {
    cssGzipBytes: css.gzipBytes,
    distBytes: dist.bytes,
    distFiles: dist.files,
    jsGzipBytes: js.gzipBytes,
  },
  legacySessionCatEntries: legacyEntries,
};

console.log(JSON.stringify(payload, null, 2));

if (css.gzipBytes > BUDGETS.cssGzipBytes) throw new Error(`CSS gzip budget exceeded: ${css.gzipBytes} > ${BUDGETS.cssGzipBytes}`);
if (js.gzipBytes > BUDGETS.jsGzipBytes) throw new Error(`JavaScript gzip budget exceeded: ${js.gzipBytes} > ${BUDGETS.jsGzipBytes}`);
if (dist.bytes > BUDGETS.distBytes) throw new Error(`desktop dist budget exceeded: ${dist.bytes} > ${BUDGETS.distBytes}`);
if (legacyEntries.length > 0) throw new Error(`legacy session-cat assets remain in dist: ${legacyEntries.join(", ")}`);
