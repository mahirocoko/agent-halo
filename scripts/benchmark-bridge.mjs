import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(scriptPath), "..");
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.join("=") || true];
}));

if (args.has("child")) {
  const modPath = String(args.get("mod"));
  const port = Number(args.get("port"));
  const eventCount = Number(args.get("events"));
  const handlers = new Map();
  const letta = {
    capabilities: { events: { lifecycle: true, turns: true, tools: true, compact: true, llm: true } },
    events: { on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); } },
    diagnostics: { report() {} },
  };
  const { default: activate } = await import(pathToFileURL(modPath).href);
  const startupStartedAt = performance.now();
  const dispose = activate(letta);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
    } catch {
      // Bridge startup is asynchronous.
    }
    if (attempt === 499) throw new Error("bridge did not start");
    await new Promise((resolveWait) => setTimeout(resolveWait, 2));
  }
  const startupMs = performance.now() - startupStartedAt;
  const handler = handlers.get("tool_end");
  const ctx = {
    cwd: "/tmp/agent-halo-benchmark",
    agent: { id: "benchmark-agent", name: "Benchmark" },
    conversation: { id: "benchmark-conversation" },
    model: "benchmark-model",
    permissionMode: "ask",
  };
  const startedAt = performance.now();
  for (let index = 0; index < eventCount; index += 1) {
    handler({
      agentId: "benchmark-agent",
      conversationId: "benchmark-conversation",
      toolCallId: `tool-${index}`,
      toolName: "Read",
      status: "success",
      output: "",
    }, ctx);
  }
  const durationMs = performance.now() - startedAt;
  dispose();
  console.log(JSON.stringify({
    startupMs,
    eventCount,
    durationMs,
    eventsPerSecond: eventCount / (durationMs / 1_000),
  }));
  process.exit(0);
}

const home = await mkdtemp(join(tmpdir(), "agent-halo-benchmark-"));
const eventCount = Number(args.get("events") ?? 5_000);
const ref = typeof args.get("ref") === "string" ? String(args.get("ref")) : null;
let modPath = resolve(repoRoot, String(args.get("mod") ?? "mods/agent-halo.js"));
const probe = createServer();
await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
const address = probe.address();
if (!address || typeof address === "string") throw new Error("failed to reserve benchmark port");
const port = address.port;
await new Promise((resolveClose) => probe.close(resolveClose));

try {
  await mkdir(join(home, ".letta", "mods"), { recursive: true });
  if (ref) {
    const baseline = spawnSync("git", ["show", `${ref}:mods/agent-halo.js`], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (baseline.status !== 0) throw new Error(baseline.stderr || `unable to read ${ref}:mods/agent-halo.js`);
    modPath = join(home, "agent-halo-ref.js");
    await writeFile(modPath, baseline.stdout);
  }
  const logFile = join(home, ".letta", "mods", "agent-halo.events.ndjson");
  await writeFile(
    join(home, ".letta", "mods", "agent-halo.config.json"),
    JSON.stringify({ host: "127.0.0.1", port, logFile }),
  );
  const child = spawn(process.execPath, [
    scriptPath,
    "--child",
    `--mod=${modPath}`,
    `--port=${port}`,
    `--events=${eventCount}`,
  ], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolveExit) => child.on("close", resolveExit));
  if (exitCode !== 0) throw new Error(stderr || `benchmark child exited ${exitCode}`);
  const result = JSON.parse(stdout.trim());
  const logBytes = (await stat(logFile)).size;
  const payload = { source: ref ? `git:${ref}` : modPath, temporaryHome: true, logBytes, ...result };
  console.log(JSON.stringify(payload, null, 2));
  if (args.has("assert")) {
    if (payload.startupMs > 100) throw new Error(`bridge startup budget exceeded: ${payload.startupMs.toFixed(2)}ms > 100ms`);
    if (payload.eventsPerSecond < 20_000) throw new Error(`bridge throughput budget missed: ${payload.eventsPerSecond.toFixed(0)} < 20000 events/s`);
    if (payload.logBytes <= 0) throw new Error("bridge benchmark did not persist its temporary event log");
  }
} finally {
  await rm(home, { recursive: true, force: true });
}
