#!/usr/bin/env node

/**
 * Agent Halo Standalone Bridge
 *
 * A self-contained HTTP bridge that can run independently of Letta Code.
 * When running, both the Letta mod and AGY adapter can forward events here
 * via POST /ingest. The Letta mod auto-detects this bridge and forwards
 * instead of starting its own.
 *
 * Usage:
 *   node agent-halo-bridge.mjs              # start with defaults
 *   node agent-halo-bridge.mjs --port 47621 # explicit port
 *   node agent-halo-bridge.mjs --daemon     # background mode (detach)
 *
 * Endpoints:
 *   GET  /health    - Bridge status and capabilities
 *   GET  /snapshot  - Current capabilities and recent events
 *   GET  /events    - Live Server-Sent Events stream
 *   POST /hook/stop - Turn completion hook relay
 *   POST /hook/attention - Attention/permission hook relay
 *   POST /ingest    - Multi-provider event fan-in
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 2;
const DEFAULT_PORT = 47621;
const MOD_DIR = join(homedir(), ".letta", "mods");
const CONFIG_PATH = join(MOD_DIR, "agent-halo.config.json");
const DEFAULT_LOG_FILE = join(MOD_DIR, "agent-halo.events.ndjson");
const INGEST_TOKEN_PATH = join(MOD_DIR, "agent-halo.ingest-token");
const BRIDGE_HOST = "127.0.0.1";

// ── Token management ──

function readOrCreateIngestToken() {
  mkdirSync(MOD_DIR, { recursive: true });
  const read = () => {
    try {
      const value = readFileSync(INGEST_TOKEN_PATH, "utf8").trim();
      return /^[a-f0-9]{64}$/i.test(value) ? value : null;
    } catch {
      return null;
    }
  };
  const existing = read();
  if (existing) return existing;
  const token = randomBytes(32).toString("hex");
  try {
    writeFileSync(INGEST_TOKEN_PATH, `${token}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return token;
  } catch {
    return read() ?? token;
  }
}

function matchesIngestToken(expected, value) {
  if (typeof value !== "string") return false;
  const provided = Buffer.from(value);
  const trusted = Buffer.from(expected);
  return provided.length === trusted.length && timingSafeEqual(provided, trusted);
}

// ── Config ──

function readConfig() {
  const fallback = {
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    logFile: DEFAULT_LOG_FILE,
    ingestToken: readOrCreateIngestToken(),
  };

  if (!existsSync(CONFIG_PATH)) return fallback;

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      ...fallback,
      ...parsed,
      port: Number.isInteger(parsed.port) ? parsed.port : fallback.port,
      host: parsed.host === BRIDGE_HOST ? parsed.host : fallback.host,
      logFile: typeof parsed.logFile === "string" ? parsed.logFile : fallback.logFile,
      ingestToken: fallback.ingestToken,
    };
  } catch {
    return fallback;
  }
}

// ── Scope tracking ──

function createScopeTracker() {
  const activeScopesByConversation = new Map();
  const activeScopesByCwd = new Map();
  const recentHookIds = new Map();
  const recentLegacySignals = new Map();
  const lastRelaySignalAtByType = new Map();
  const recentCompletionAtByCwd = new Map();
  const recentCompletedScopesByCwd = new Map();
  const legacySignalRetentionMs = 5_000;
  const recentScopeRetentionMs = 15_000;
  const hookIdRetentionMs = 60_000;
  const activeScopeRetentionMs = 30 * 60_000;
  const cleanupIntervalMs = 1_000;
  let nextRecentCleanupAt = 0;

  const lastScope = {
    agentId: null, agentName: null, conversationId: null,
    cwd: null, model: null, permissionMode: null, runtime: null,
  };

  const cloneScope = (scope) => ({
    agentId: scope.agentId ?? null,
    agentName: scope.agentName ?? null,
    conversationId: scope.conversationId ?? null,
    cwd: scope.cwd ?? null,
    model: scope.model ?? null,
    permissionMode: scope.permissionMode ?? null,
    runtime: scope.runtime && typeof scope.runtime === "object" ? { ...scope.runtime } : null,
  });

  const removeActiveScope = (conversationId) => {
    if (!conversationId) return;
    const record = activeScopesByConversation.get(conversationId);
    activeScopesByConversation.delete(conversationId);
    if (!record?.scope.cwd) return;
    const cwdScopes = activeScopesByCwd.get(record.scope.cwd);
    cwdScopes?.delete(conversationId);
    if (cwdScopes?.size === 0) activeScopesByCwd.delete(record.scope.cwd);
  };

  const cleanupRecentState = (now) => {
    if (now < nextRecentCleanupAt) return;
    nextRecentCleanupAt = now + cleanupIntervalMs;
    for (const [key, seenAt] of recentLegacySignals) {
      if (now - seenAt > legacySignalRetentionMs) recentLegacySignals.delete(key);
    }
    for (const [cwd, completedAt] of recentCompletionAtByCwd) {
      if (now - completedAt > recentScopeRetentionMs) recentCompletionAtByCwd.delete(cwd);
    }
    for (const [cwd, cwdScopes] of recentCompletedScopesByCwd) {
      for (const [conversationId, record] of cwdScopes) {
        if (now - record.completedAt > recentScopeRetentionMs) cwdScopes.delete(conversationId);
      }
      if (cwdScopes.size === 0) recentCompletedScopesByCwd.delete(cwd);
    }
    for (const [hookId, seenAt] of recentHookIds) {
      if (now - seenAt > hookIdRetentionMs) recentHookIds.delete(hookId);
    }
    const stale = [];
    for (const [conversationId, record] of activeScopesByConversation) {
      if (now - record.lastActiveAt > activeScopeRetentionMs) stale.push(conversationId);
    }
    for (const conversationId of stale) removeActiveScope(conversationId);
  };

  const isTerminalLlmEvent = (payload) => {
    if (payload.type !== "llm_end") return false;
    const reason = String(payload.data?.stopReason ?? "").toLowerCase();
    return reason.includes("end") || reason.includes("stop") || reason.includes("done") || reason.includes("complete") || Boolean(payload.data?.error);
  };

  const rememberCompletedScope = (payload, now) => {
    if (!payload.cwd || !payload.conversationId) return;
    const cwdScopes = recentCompletedScopesByCwd.get(payload.cwd) ?? new Map();
    cwdScopes.set(payload.conversationId, { scope: cloneScope(payload), completedAt: now });
    recentCompletedScopesByCwd.set(payload.cwd, cwdScopes);
  };

  const recentCompletedScopes = (cwd, now) => {
    if (!cwd) return [];
    cleanupRecentState(now);
    const cwdScopes = recentCompletedScopesByCwd.get(cwd);
    if (!cwdScopes) return [];
    for (const [conversationId, record] of cwdScopes) {
      if (now - record.completedAt > recentScopeRetentionMs) cwdScopes.delete(conversationId);
    }
    if (cwdScopes.size === 0) recentCompletedScopesByCwd.delete(cwd);
    return [...cwdScopes.values()];
  };

  const rememberScope = (payload) => {
    const now = Date.now();
    cleanupRecentState(now);
    for (const key of Object.keys(lastScope)) {
      if (payload[key] != null) lastScope[key] = payload[key];
    }
    if (["turn_start", "tool_start", "compact_start", "llm_start", "attention_requested"].includes(payload.type)) {
      const scope = cloneScope(lastScope);
      if (payload.type === "turn_start" && scope.cwd) recentCompletionAtByCwd.delete(scope.cwd);
      if (scope.conversationId) {
        removeActiveScope(scope.conversationId);
        const record = { scope, lastActiveAt: now };
        activeScopesByConversation.set(scope.conversationId, record);
        if (scope.cwd) {
          const cwdScopes = activeScopesByCwd.get(scope.cwd) ?? new Map();
          cwdScopes.set(scope.conversationId, record);
          activeScopesByCwd.set(scope.cwd, cwdScopes);
        }
      }
    }
    if (["turn_complete", "turn_stop", "conversation_close"].includes(payload.type) || isTerminalLlmEvent(payload)) {
      if (payload.cwd) recentCompletionAtByCwd.set(payload.cwd, now);
      rememberCompletedScope(payload, now);
      removeActiveScope(payload.conversationId);
    }
  };

  const hookScope = (data, now) => {
    const requestedCwd = typeof data.cwd === "string" && data.cwd.length > 0
      ? data.cwd
      : typeof data.workingDirectory === "string" && data.workingDirectory.length > 0
        ? data.workingDirectory : null;
    const requestedConversationId = typeof data.conversationId === "string" && data.conversationId.length > 0 ? data.conversationId : null;
    const requestedAgentId = typeof data.agentId === "string" && data.agentId.length > 0 ? data.agentId : null;
    let candidates = [];
    if (requestedConversationId) {
      const exact = activeScopesByConversation.get(requestedConversationId);
      if (exact) candidates = [exact];
    } else if (requestedCwd) {
      candidates = [...(activeScopesByCwd.get(requestedCwd)?.values() ?? [])];
      if (candidates.length === 0) candidates = recentCompletedScopes(requestedCwd, now);
    } else {
      candidates = [...activeScopesByConversation.values()];
    }
    if (requestedAgentId) {
      candidates = candidates.filter((record) => record.scope.agentId === requestedAgentId);
    }
    const scope = cloneScope(candidates.length === 1 ? candidates[0].scope : {});
    if (requestedConversationId) scope.conversationId = requestedConversationId;
    if (requestedAgentId) scope.agentId = requestedAgentId;
    if (requestedCwd) scope.cwd = requestedCwd;
    for (const key of Object.keys(scope)) {
      if (typeof data[key] === "string" && data[key].length > 0) scope[key] = data[key];
    }
    return scope;
  };

  const shouldEmitHookSignal = (type, scope, data, now) => {
    cleanupRecentState(now);
    const hookId = typeof data.hookId === "string" && data.hookId.length > 0 ? data.hookId : null;
    if (hookId) {
      const seenAt = recentHookIds.get(hookId);
      if (seenAt != null && now - seenAt <= hookIdRetentionMs) return false;
      recentHookIds.set(hookId, now);
      lastRelaySignalAtByType.set(type, now);
      return true;
    }
    if (now - (lastRelaySignalAtByType.get(type) ?? 0) <= legacySignalRetentionMs) return false;
    const legacyKey = [type, scope.conversationId ?? "", scope.cwd ?? ""].join(":");
    const previous = recentLegacySignals.get(legacyKey) ?? 0;
    recentLegacySignals.set(legacyKey, now);
    return now - previous > legacySignalRetentionMs;
  };

  return { rememberScope, hookScope, shouldEmitHookSignal, recentCompletionAtByCwd };
}

// ── Bridge server ──

function startBridge(config) {
  mkdirSync(dirname(config.logFile), { recursive: true });

  const capabilities = {
    events: { lifecycle: true, turns: true, tools: true, compact: true, llm: true },
    endpoints: { health: true, snapshot: true, sse: true, hookStop: true, hookAttention: true, ingest: true },
    sessionActions: { focusTerminal: false, endSession: false, dismissEnded: true },
  };

  const clients = new Set();
  const maxRecent = 500;
  const recent = readRecentEvents(config.logFile, maxRecent);
  const tracker = createScopeTracker();

  const emitLocal = (payload) => {
    tracker.rememberScope(payload);
    recent.push(payload);
    if (recent.length > maxRecent) recent.shift();

    const serialized = JSON.stringify(payload);
    appendFileSync(config.logFile, `${serialized}\n`);

    const frame = `event: ${payload.type}\ndata: ${serialized}\n\n`;
    for (const res of clients) {
      try { res.write(frame); } catch { clients.delete(res); }
    }
  };

  const emitHookStop = (data = {}) => {
    const now = Date.now();
    const scope = tracker.hookScope(data, now);
    if (!tracker.shouldEmitHookSignal("turn_complete", scope, data, now)) return;
    emitLocal({
      version: PROTOCOL_VERSION, id: randomUUID(), type: "turn_complete",
      timestamp: new Date().toISOString(), ...scope,
      data: {
        hookEventName: typeof data.hookEventName === "string" ? data.hookEventName : "Stop",
        source: typeof data.source === "string" ? data.source : "hook",
        message: typeof data.message === "string" ? data.message : null,
      },
    });
  };

  const emitHookAttention = (data = {}) => {
    const now = Date.now();
    const scope = tracker.hookScope(data, now);
    const isNotificationHook = data.hookEventName === "Notification";
    if (isNotificationHook && scope.cwd && now - (tracker.recentCompletionAtByCwd.get(scope.cwd) ?? 0) <= 15_000) return;
    if (!tracker.shouldEmitHookSignal("attention_requested", scope, data, now)) return;
    emitLocal({
      version: PROTOCOL_VERSION, id: randomUUID(), type: "attention_requested",
      timestamp: new Date().toISOString(), ...scope,
      data: {
        hookEventName: typeof data.hookEventName === "string" ? data.hookEventName : "PermissionRequest",
        source: typeof data.source === "string" ? data.source : "hook",
        kind: isNotificationHook ? "question" : "approval",
        toolName: typeof data.toolName === "string" ? data.toolName : null,
        message: typeof data.message === "string" ? data.message : null,
      },
    });
  };

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept, x-agent-halo-token",
  };

  const readJsonBody = (req) =>
    new Promise((resolve) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16_384) { req.destroy(); resolve({}); }
      });
      req.on("end", () => {
        if (!body.trim()) { resolve({}); return; }
        try { resolve(JSON.parse(body)); } catch { resolve({}); }
      });
      req.on("error", () => resolve({}));
    });

  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/ingest") {
      const body = await readJsonBody(req);
      if (body && typeof body === "object" && typeof body.type === "string" && typeof body.id === "string") {
        const runtimeTrusted = matchesIngestToken(config.ingestToken, req.headers["x-agent-halo-token"]);
        const payload = runtimeTrusted ? body : { ...body, runtime: null };
        emitLocal(payload);
        res.writeHead(202, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
        res.end(JSON.stringify({ ok: true, type: body.type, runtimeTrusted }));
        return;
      }
      res.writeHead(400, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
      res.end(JSON.stringify({ ok: false, error: "invalid_event" }));
      return;
    }

    if (req.method === "POST" && req.url === "/hook/stop") {
      const body = await readJsonBody(req);
      emitHookStop(body);
      res.writeHead(202, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
      res.end(JSON.stringify({ ok: true, type: "turn_complete" }));
      return;
    }

    if (req.method === "POST" && req.url === "/hook/attention") {
      const body = await readJsonBody(req);
      emitHookAttention(body);
      res.writeHead(202, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
      res.end(JSON.stringify({ ok: true, type: "attention_requested" }));
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
      res.end(JSON.stringify({ ok: true, name: "agent-halo", version: PROTOCOL_VERSION, mode: "standalone", clients: clients.size, capabilities }));
      return;
    }

    if (req.url === "/snapshot") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
      res.end(JSON.stringify({ ok: true, recent, capabilities }));
      return;
    }

    if (req.url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        ...corsHeaders,
      });
      res.write(`: agent-halo standalone bridge connected ${new Date().toISOString()}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  return { server, emitLocal, capabilities };
}

function readRecentEvents(logFile, maxRecent) {
  try {
    if (!existsSync(logFile)) return [];
    return readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .slice(-maxRecent)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter((event) => event && typeof event.type === "string" && typeof event.id === "string");
  } catch {
    return [];
  }
}

// ── CLI ──

const args = process.argv.slice(2);
const portArg = args.includes("--port") ? Number(args[args.indexOf("--port") + 1]) : null;
const hostArg = args.includes("--host") ? args[args.indexOf("--host") + 1] : null;
const daemon = args.includes("--daemon");
const parentStdio = args.includes("--parent-stdio");

const config = readConfig();
if (portArg && Number.isInteger(portArg)) config.port = portArg;
if (hostArg === BRIDGE_HOST) config.host = hostArg;

const { server, emitLocal } = startBridge(config);

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`✗ Port ${config.port} already in use (Letta mod or another bridge is running)`);
    process.exit(1);
  }
  console.error(`✗ Bridge error: ${error.message}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const bridgeReadyEvent = {
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    type: "bridge_ready",
    timestamp: new Date().toISOString(),
    agentId: null, agentName: null, conversationId: null,
    cwd: null, model: null, permissionMode: null, runtime: null,
    data: {
      port: config.port,
      logFile: config.logFile,
      ssePath: "/events",
      healthPath: "/health",
    },
  };
  emitLocal(bridgeReadyEvent);

  console.log(`✓ Agent Halo standalone bridge running on ${config.host}:${config.port}`);
  console.log(`  Log: ${config.logFile}`);
  console.log(`  SSE: http://${config.host}:${config.port}/events`);
  console.log(`  Health: http://${config.host}:${config.port}/health`);
  console.log(`  Mode: standalone (accepts Letta /ingest + AGY /ingest + hooks)`);

  if (daemon) {
    // Detach from terminal
    process.stdin.unref();
    process.stdout.write("");
    if (typeof process.disconnect === "function") process.disconnect();
  }
});

// Graceful shutdown
const shutdown = () => {
  console.log("\n⏹ Bridge shutting down...");
  server.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (parentStdio) {
  process.stdin.resume();
  process.stdin.once("end", shutdown);
  process.stdin.once("error", shutdown);
}
