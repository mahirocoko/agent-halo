import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const repoRoot = resolve(import.meta.dirname, "..");
const distRoot = join(repoRoot, "apps/desktop/dist");
const assetRoot = join(distRoot, "assets");

const BUDGETS = {
  coreDistBytes: 575_500,
  cssGzipBytes: 11_100,
  haloBotAssetBytes: 50_000,
  haloformAssetBytes: 85_000,
  jsGzipBytes: 97_300,
  movementAssetBytes: 28_250_000,
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

const largestAsset = (extension) => assets
  .filter((asset) => asset.name.endsWith(extension))
  .sort((left, right) => right.gzipBytes - left.gzipBytes)[0];
const css = largestAsset(".css");
const js = largestAsset(".js");
if (!css || !js) throw new Error("desktop build is missing its primary CSS or JavaScript asset");

const dist = await walk(distRoot);
const movementAssets = await walk(join(distRoot, "mediapipe"));
const haloBotAssets = await walk(join(distRoot, "mascots", "agent-halo-roster", "body", "halo-bot"));
const haloformAssets = await walk(join(distRoot, "mascots", "agent-halo-roster", "body", "haloform"));
const movementRuntimeBytes = assets
  .filter((asset) => asset.name.startsWith("vision_bundle-"))
  .reduce((total, asset) => total + asset.bytes, 0);
const movementAssetBytes = movementAssets.bytes + movementRuntimeBytes;
const coreDistBytes = dist.bytes - movementAssetBytes - haloBotAssets.bytes - haloformAssets.bytes;
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
  baselineCommit: "3fc8ff8",
  budgetRevision: "inactive-group-removal",
  budgets: BUDGETS,
  current: {
    cssGzipBytes: css.gzipBytes,
    coreDistBytes,
    distFiles: dist.files,
    haloBotAssetBytes: haloBotAssets.bytes,
    haloformAssetBytes: haloformAssets.bytes,
    jsGzipBytes: js.gzipBytes,
    movementAssetBytes,
  },
  legacySessionCatEntries: legacyEntries,
};

console.log(JSON.stringify(payload, null, 2));

if (css.gzipBytes > BUDGETS.cssGzipBytes) throw new Error(`CSS gzip budget exceeded: ${css.gzipBytes} > ${BUDGETS.cssGzipBytes}`);
if (js.gzipBytes > BUDGETS.jsGzipBytes) throw new Error(`JavaScript gzip budget exceeded: ${js.gzipBytes} > ${BUDGETS.jsGzipBytes}`);
if (coreDistBytes > BUDGETS.coreDistBytes) throw new Error(`desktop core dist budget exceeded: ${coreDistBytes} > ${BUDGETS.coreDistBytes}`);
if (haloBotAssets.bytes > BUDGETS.haloBotAssetBytes) throw new Error(`Halo Bot asset budget exceeded: ${haloBotAssets.bytes} > ${BUDGETS.haloBotAssetBytes}`);
if (haloformAssets.bytes > BUDGETS.haloformAssetBytes) throw new Error(`Haloform asset budget exceeded: ${haloformAssets.bytes} > ${BUDGETS.haloformAssetBytes}`);
if (movementAssetBytes > BUDGETS.movementAssetBytes) throw new Error(`movement asset budget exceeded: ${movementAssetBytes} > ${BUDGETS.movementAssetBytes}`);
if (legacyEntries.length > 0) throw new Error(`legacy session-cat assets remain in dist: ${legacyEntries.join(", ")}`);
