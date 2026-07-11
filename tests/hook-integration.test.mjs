import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

test("mod installer copies the relay idempotently without changing global settings", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-halo-install-"));
  const settingsPath = join(home, ".letta", "settings.json");
  await mkdir(join(home, ".letta"), { recursive: true });
  const original = {
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "say finished", timeout: 10_000 }] }],
      Notification: [{ hooks: [{ type: "command", command: "say attention", timeout: 10_000 }] }],
    },
    theme: "dark",
  };
  await writeFile(settingsPath, `${JSON.stringify(original, null, 2)}\n`);
  await chmod(settingsPath, 0o640);

  try {
    for (let index = 0; index < 2; index += 1) {
      const result = spawnSync(process.execPath, ["scripts/install-mod.mjs"], {
        cwd: repoRoot,
        env: { ...process.env, HOME: home },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
    }

    const installed = JSON.parse(await readFile(settingsPath, "utf8"));
    assert.deepEqual(installed, original);
    assert.equal((await stat(settingsPath)).mode & 0o777, 0o640);
    assert.match(await readFile(join(home, ".letta", "mods", "agent-halo.js"), "utf8"), /attention_requested/);
    assert.match(await readFile(join(home, ".letta", "hooks", "agent-halo-hook.mjs"), "utf8"), /PermissionRequest/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("hook relay honors loopback bridge config and sends scoped permission metadata", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-halo-relay-"));
  await mkdir(join(home, ".letta", "mods"), { recursive: true });
  let received;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received = { path: request.url, payload: JSON.parse(body) };
      response.writeHead(202);
      response.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  await writeFile(
    join(home, ".letta", "mods", "agent-halo.config.json"),
    JSON.stringify({ host: "127.0.0.1", port: address.port }),
  );

  try {
    const child = spawn(process.execPath, ["hooks/agent-halo-hook.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home },
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stdin.end(JSON.stringify({
      event_type: "PermissionRequest",
      working_directory: "/tmp/project",
      agent_id: "agent-test",
      conversation_id: "conv-test",
      tool_name: "exec_command",
      permission: { type: "tool", scope: "session" },
    }));
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0);
    assert.equal(received.path, "/hook/attention");
    assert.equal(received.payload.workingDirectory, "/tmp/project");
    assert.equal(received.payload.agentId, "agent-test");
    assert.equal(received.payload.conversationId, "conv-test");
    assert.equal(received.payload.toolName, "exec_command");
    assert.equal(typeof received.payload.hookId, "string");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test("bridge leaves same-cwd hook signals unscoped and keeps unique rapid hook ids", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-halo-scope-"));
  await mkdir(join(home, ".letta", "mods"), { recursive: true });
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise((resolve) => probe.close(resolve));
  await writeFile(join(home, ".letta", "mods", "agent-halo.config.json"), JSON.stringify({ host: "127.0.0.1", port }));

  const modUrl = new URL("../mods/agent-halo.js", import.meta.url).href;
  const script = `
    const handlers = new Map();
    const letta = {
      capabilities: { events: { lifecycle: true, turns: true, tools: true, compact: true, llm: true } },
      events: { on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); } },
      diagnostics: { report() {} },
    };
    const { default: activate } = await import(${JSON.stringify(modUrl)});
    const dispose = activate(letta);
    const waitForBridge = async () => {
      for (let index = 0; index < 50; index += 1) {
        try { if ((await fetch('http://127.0.0.1:${port}/health')).ok) return; } catch {}
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('bridge did not start');
    };
    await waitForBridge();
    const ctx = (id) => ({ cwd: '/tmp/shared', agent: { id: 'agent-test', name: 'Test' }, conversation: { id }, model: 'gpt-test', permissionMode: 'ask' });
    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-a', input: [] }, ctx('conv-a'));
    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-b', input: [] }, ctx('conv-b'));
    const send = (payload) => fetch('http://127.0.0.1:${port}/hook/attention', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    await send({ hookId: 'ambiguous', workingDirectory: '/tmp/shared', hookEventName: 'PermissionRequest' });
    await send({ hookId: 'explicit-1', workingDirectory: '/tmp/shared', conversationId: 'conv-a', hookEventName: 'PermissionRequest' });
    await send({ hookId: 'explicit-2', workingDirectory: '/tmp/shared', conversationId: 'conv-a', hookEventName: 'PermissionRequest' });
    handlers.get('llm_end')({ agentId: 'agent-test', conversationId: 'conv-a', model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx('conv-a'));
    await send({ hookId: 'notification-after-stop', workingDirectory: '/tmp/shared', hookEventName: 'Notification' });
    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-a', input: [] }, ctx('conv-a'));
    await send({ hookId: 'notification-question', workingDirectory: '/tmp/shared', conversationId: 'conv-a', hookEventName: 'Notification' });
    const snapshot = await (await fetch('http://127.0.0.1:${port}/snapshot')).json();
    const attention = snapshot.recent.filter((event) => event.type === 'attention_requested');
    console.log(JSON.stringify(attention.map((event) => ({ id: event.id, conversationId: event.conversationId, cwd: event.cwd, kind: event.data.kind }))));
    dispose();
  `;

  try {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const exitCode = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(exitCode, 0, stderr);
    const attention = JSON.parse(stdout.trim());
    assert.equal(attention.length, 4);
    assert.equal(attention[0].conversationId, null);
    assert.deepEqual(attention.slice(1, 3).map((event) => event.conversationId), ["conv-a", "conv-a"]);
    assert.equal(attention.at(-1).conversationId, "conv-a");
    assert.equal(attention.at(-1).kind, "question");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
