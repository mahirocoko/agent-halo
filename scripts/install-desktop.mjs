#!/usr/bin/env node
import { existsSync, cpSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const appName = "Agent Halo.app";
const builtApp = join(root, "apps/desktop/src-tauri/target/release/bundle/macos", appName);
const fallbackApp = join(root, "apps/desktop/src-tauri/target/release", appName);
const installDir = process.env.AGENT_HALO_INSTALL_DIR || join(homedir(), "Applications");
const installPath = join(installDir, appName);

const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm", ["desktop:build"]);

const sourceApp = existsSync(builtApp) ? builtApp : fallbackApp;
if (!existsSync(sourceApp)) {
  console.error(`Agent Halo app bundle not found at ${builtApp}`);
  process.exit(1);
}

rmSync(installPath, { recursive: true, force: true });
cpSync(sourceApp, installPath, { recursive: true });

console.log(`Installed ${appName} → ${installPath}`);
console.log("Open it, then use Setup → Install/Reinstall to install the Letta mod if needed.");
console.log("After first mod install, reload or restart Letta Code so it loads ~/.letta/mods/agent-halo.js.");
