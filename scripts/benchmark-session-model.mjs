import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const repoRoot = resolve(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));
const assertBudgets = args.has("--assert");

const probe = createServer();
await new Promise((resolveListen) => probe.listen(0, "127.0.0.1", resolveListen));
const address = probe.address();
if (!address || typeof address === "string") throw new Error("failed to reserve session benchmark port");
const port = address.port;
await new Promise((resolveClose) => probe.close(resolveClose));

const server = spawn("pnpm", ["--filter", "@agent-halo/desktop", "exec", "vite", "--host", "127.0.0.1", "--port", `${port}`], {
  cwd: repoRoot,
  detached: process.platform !== "win32",
  stdio: ["ignore", "pipe", "pipe"],
});
const serverClosed = new Promise((resolveClose) => server.once("close", resolveClose));
let serverError = "";
server.stderr.on("data", (chunk) => { serverError += chunk; });
const serverReady = new Promise((resolveReady, rejectReady) => {
  const timeout = setTimeout(() => rejectReady(new Error(serverError || "desktop benchmark server did not start")), 10_000);
  server.stdout.on("data", (chunk) => {
    if (!chunk.toString().includes("Local:")) return;
    clearTimeout(timeout);
    resolveReady();
  });
  server.once("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) rejectReady(new Error(serverError || `desktop benchmark server exited ${code}`));
  });
});
let browser = null;

try {
  await serverReady;

  browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/?demo=1&demoScenario=multi`);
  const result = await page.evaluate(async () => {
    const model = await import(`/src/features/session/model.ts?benchmark=${Date.now()}`);
    const makeEvent = (conversationId, index) => ({
      version: 2,
      id: `${conversationId}-${index}`,
      timestamp: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
      type: "conversation_open",
      agentId: `agent-${conversationId}`,
      agentName: "Benchmark",
      conversationId,
      cwd: `/tmp/${conversationId}`,
      model: "benchmark/model",
      permissionMode: "default",
      data: { reason: "benchmark", previousConversationId: null },
    });
    const registry = {};
    for (let conversationIndex = 0; conversationIndex < 100; conversationIndex += 1) {
      const conversationId = `conversation-${conversationIndex}`;
      registry[conversationId] = Array.from({ length: 32 }, (_, eventIndex) => makeEvent(conversationId, eventIndex)).reverse();
    }
    const incoming = Array.from({ length: 500 }, (_, index) => makeEvent(`conversation-${index % 100}`, 32 + index));
    const presence = {
      status: "idle",
      agentId: null,
      agentName: null,
      conversationId: null,
      cwd: null,
      model: null,
      permissionMode: null,
      activeTool: null,
      detail: null,
      lastEventAt: null,
      error: null,
    };
    const sessions = Array.from({ length: 1_000 }, (_, index) => ({
      conversationId: `session-${index}`,
      project: `project-${index % 100}`,
      workspace: `~/workspace/${index % 100}`,
      workspacePath: `/workspace/${index % 100}`,
      detail: "working",
      activityKind: "tool",
      model: "benchmark",
      status: index % 7 === 0 ? "done" : index % 11 === 0 ? "attention" : "working",
      lastActivityAt: new Date(1_700_000_000_000 + index * 1_000).toISOString(),
    }));
    const benchmark = (callback) => {
      for (let index = 0; index < 10; index += 1) callback();
      const values = [];
      for (let index = 0; index < 60; index += 1) {
        const startedAt = performance.now();
        callback();
        values.push(performance.now() - startedAt);
      }
      values.sort((left, right) => left - right);
      return {
        p50: values[Math.floor(values.length * 0.5)],
        p95: values[Math.floor(values.length * 0.95)],
        max: values.at(-1),
      };
    };
    return {
      merge: benchmark(() => model.mergeSessionEvents(registry, incoming)),
      summaries: benchmark(() => model.buildSessionSummaries(registry, presence, new Date(1_700_001_000_000))),
      groups: benchmark(() => model.buildWorkspaceSessionGroups(sessions)),
      workload: { conversations: 100, existingEvents: 3_200, incomingEvents: 500, groupSessions: 1_000 },
    };
  });
  await browser.close();
  browser = null;

  const budgets = {
    mergeP95Ms: 2.5,
    summariesP95Ms: 0.5,
    groupsP95Ms: 1.5,
  };
  console.log(JSON.stringify({ baselineCommit: "4a5c0f1", budgets, result }, null, 2));
  if (assertBudgets) {
    if (result.merge.p95 > budgets.mergeP95Ms) throw new Error(`session merge p95 budget exceeded: ${result.merge.p95.toFixed(2)}ms`);
    if (result.summaries.p95 > budgets.summariesP95Ms) throw new Error(`session summary p95 budget exceeded: ${result.summaries.p95.toFixed(2)}ms`);
    if (result.groups.p95 > budgets.groupsP95Ms) throw new Error(`session grouping p95 budget exceeded: ${result.groups.p95.toFixed(2)}ms`);
  }
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null && server.pid) {
    if (process.platform === "win32") server.kill("SIGTERM");
    else {
      try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill("SIGTERM"); }
    }
  }
  await Promise.race([serverClosed, new Promise((resolveWait) => setTimeout(resolveWait, 2_000))]);
}
