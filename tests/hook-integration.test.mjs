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

test("bridge remembers each event once and amortizes recent correlation cleanup", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-halo-hot-path-"));
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
    const NativeMap = globalThis.Map;
    const trackedMaps = [];
    globalThis.Map = class TrackedMap extends NativeMap {
      constructor(entries) {
        super(entries);
        trackedMaps.push(this);
      }
    };
    const handlers = new NativeMap();
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

    const realNow = Date.now;
    let now = realNow();
    let dateNowCalls = 0;
    Date.now = () => { dateNowCalls += 1; return now; };
    const ctx = (id, cwd) => ({ cwd, agent: { id: 'agent-test', name: 'Test' }, conversation: { id }, model: 'gpt-test', permissionMode: 'ask' });
    const post = (path, payload) => fetch('http://127.0.0.1:${port}' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

    let before = dateNowCalls;
    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-once', input: [] }, ctx('conv-once', '/tmp/once'));
    const turnStartDateNowCalls = dateNowCalls - before;
    before = dateNowCalls;
    handlers.get('llm_end')({ agentId: 'agent-test', conversationId: 'conv-once', model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx('conv-once', '/tmp/once'));
    const llmEndDateNowCalls = dateNowCalls - before;

    await post('/hook/attention', { workingDirectory: '/tmp/once', conversationId: 'conv-once', hookEventName: 'PermissionRequest', message: 'cleanup-legacy' });
    await post('/hook/stop', { hookId: 'cleanup-hook', workingDirectory: '/tmp/once', conversationId: 'conv-once', hookEventName: 'Stop' });
    const cleanupMaps = {
      hookIds: trackedMaps.find((map) => map.has('cleanup-hook')),
      legacy: trackedMaps.find((map) => map.has('attention_requested:conv-once:/tmp/once')),
      completion: trackedMaps.find((map) => typeof map.get('/tmp/once') === 'number'),
      completedScopes: trackedMaps.find((map) => map.get('/tmp/once') instanceof NativeMap),
    };
    const cleanupPopulated = Object.values(cleanupMaps).every(Boolean);

    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-notify', input: [] }, ctx('conv-notify', '/tmp/notify'));
    handlers.get('llm_end')({ agentId: 'agent-test', conversationId: 'conv-notify', model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx('conv-notify', '/tmp/notify'));
    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-delayed', input: [] }, ctx('conv-delayed', '/tmp/delayed'));
    handlers.get('llm_end')({ agentId: 'agent-test', conversationId: 'conv-delayed', model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx('conv-delayed', '/tmp/delayed'));
    now += 15_000;
    await post('/hook/attention', { hookId: 'notify-at-boundary', workingDirectory: '/tmp/notify', hookEventName: 'Notification', message: 'boundary-suppressed' });
    await post('/hook/stop', { hookId: 'delayed-at-boundary', workingDirectory: '/tmp/delayed', hookEventName: 'Stop', message: 'delayed-boundary' });
    now += 1;
    await post('/hook/attention', { hookId: 'notify-after-boundary', workingDirectory: '/tmp/notify', hookEventName: 'Notification', message: 'after-boundary' });

    now += 6_000;
    await post('/hook/attention', { workingDirectory: '/tmp/legacy', conversationId: 'conv-legacy', hookEventName: 'PermissionRequest', message: 'legacy-first' });
    now += 5_000;
    await post('/hook/attention', { workingDirectory: '/tmp/legacy', conversationId: 'conv-legacy', hookEventName: 'PermissionRequest', message: 'legacy-at-boundary' });
    now += 5_001;
    await post('/hook/attention', { workingDirectory: '/tmp/legacy', conversationId: 'conv-legacy', hookEventName: 'PermissionRequest', message: 'legacy-after-boundary' });

    handlers.get('turn_start')({ agentId: 'agent-test', conversationId: 'conv-long', input: [] }, ctx('conv-long', '/tmp/long-running'));
    now += 60_001;
    handlers.get('tool_end')({ agentId: 'agent-test', conversationId: 'conv-other', toolCallId: 'cleanup-trigger', toolName: 'Read', status: 'success', output: '' }, ctx('conv-other', '/tmp/other'));
    await post('/hook/stop', { hookId: 'long-running-active', workingDirectory: '/tmp/long-running', hookEventName: 'Stop', message: 'long-running-active' });
    const cleanupCleared = {
      hookIds: !cleanupMaps.hookIds.has('cleanup-hook'),
      legacy: !cleanupMaps.legacy.has('attention_requested:conv-once:/tmp/once'),
      completion: !cleanupMaps.completion.has('/tmp/once'),
      completedScopes: !cleanupMaps.completedScopes.has('/tmp/once'),
    };

    const snapshot = await (await fetch('http://127.0.0.1:${port}/snapshot')).json();
    const delayed = snapshot.recent.find((event) => event.data?.message === 'delayed-boundary');
    const suppressed = snapshot.recent.some((event) => event.data?.message === 'boundary-suppressed');
    const afterBoundary = snapshot.recent.find((event) => event.data?.message === 'after-boundary');
    const longRunning = snapshot.recent.find((event) => event.data?.message === 'long-running-active');
    const legacyMessages = snapshot.recent.filter((event) => String(event.data?.message ?? '').startsWith('legacy-')).map((event) => event.data.message);
    console.log(JSON.stringify({
      turnStartDateNowCalls,
      llmEndDateNowCalls,
      cleanupPopulated,
      cleanupCleared,
      delayedConversationId: delayed?.conversationId,
      suppressed,
      afterBoundaryConversationId: afterBoundary?.conversationId,
      longRunningConversationId: longRunning?.conversationId,
      legacyMessages,
    }));
    Date.now = realNow;
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
    const result = JSON.parse(stdout.trim());
    assert.equal(result.turnStartDateNowCalls, 1);
    assert.equal(result.llmEndDateNowCalls, 1);
    assert.equal(result.cleanupPopulated, true);
    assert.deepEqual(result.cleanupCleared, { hookIds: true, legacy: true, completion: true, completedScopes: true });
    assert.equal(result.delayedConversationId, "conv-delayed");
    assert.equal(result.suppressed, false);
    assert.equal(result.afterBoundaryConversationId, null);
    assert.equal(result.longRunningConversationId, "conv-long");
    assert.deepEqual(result.legacyMessages, ["legacy-first", "legacy-after-boundary"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("bridge normalizes default lanes and safely correlates delayed completion hooks", async () => {
  const home = await mkdtemp(join(tmpdir(), "agent-halo-detection-"));
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
    const ctx = (id, cwd = '/tmp/recent', agentId = 'agent-main') => ({ cwd, agent: { id: agentId, name: 'Test' }, conversation: { id }, model: 'gpt-test', permissionMode: 'ask' });

    handlers.get('tool_start')(
      { agentId: 'agent-fallback', conversationId: 'default', toolCallId: 'fallback-tool', toolName: 'Read', args: {} },
      ctx('default', '/tmp/fallback', 'agent-fallback'),
    );

    handlers.get('turn_start')({ agentId: 'agent-main', conversationId: 'conv-a', input: [] }, ctx('conv-a'));
    handlers.get('llm_end')({ agentId: 'agent-main', conversationId: 'conv-a', model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx('conv-a'));
    await fetch('http://127.0.0.1:${port}/hook/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hookId: 'recent-complete', workingDirectory: '/tmp/recent', hookEventName: 'Stop' }) });

    for (const id of ['conv-b', 'conv-c']) {
      handlers.get('turn_start')({ agentId: 'agent-main', conversationId: id, input: [] }, ctx(id, '/tmp/ambiguous'));
      handlers.get('llm_end')({ agentId: 'agent-main', conversationId: id, model: 'gpt-test', stopReason: 'stop', usage: null, durationMs: 10 }, ctx(id, '/tmp/ambiguous'));
    }
    await fetch('http://127.0.0.1:${port}/hook/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hookId: 'ambiguous-complete', workingDirectory: '/tmp/ambiguous', hookEventName: 'Stop' }) });

    const snapshot = await (await fetch('http://127.0.0.1:${port}/snapshot')).json();
    const fallback = snapshot.recent.find((event) => event.data?.toolCallId === 'fallback-tool');
    const completions = snapshot.recent.filter((event) => event.type === 'turn_complete');
    console.log(JSON.stringify({ fallbackConversationId: fallback?.conversationId, completionIds: completions.map((event) => event.conversationId) }));
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
    const result = JSON.parse(stdout.trim());
    assert.equal(result.fallbackConversationId, "agent:agent-fallback");
    assert.deepEqual(result.completionIds, ["conv-a", null]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
