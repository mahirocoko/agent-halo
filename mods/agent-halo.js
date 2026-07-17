import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 2;
const DEFAULT_PORT = 47621;
const MOD_DIR = join(homedir(), ".letta", "mods");
const CONFIG_PATH = join(MOD_DIR, "agent-halo.config.json");
const DEFAULT_LOG_FILE = join(MOD_DIR, "agent-halo.events.ndjson");
const INGEST_TOKEN_PATH = join(MOD_DIR, "agent-halo.ingest-token");
const HOST_STARTED_AT_MS = Math.round(Date.now() - process.uptime() * 1_000);
const HOST_RUNTIME = Object.freeze({
  sourcePid: process.pid,
  sourcePpid: Number.isInteger(process.ppid) && process.ppid > 0 ? process.ppid : null,
  sourceStartedAtMs: HOST_STARTED_AT_MS,
  sourceKind: "lettaHost",
});

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

function readConfig() {
  const fallback = {
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    logFile: DEFAULT_LOG_FILE,
    ingestToken: readOrCreateIngestToken(),
    captureTextPreview: false,
    maxTextPreviewLength: 160,
  };

  if (!existsSync(CONFIG_PATH)) return fallback;

  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return {
      ...fallback,
      ...parsed,
      port: Number.isInteger(parsed.port) ? parsed.port : fallback.port,
      host: typeof parsed.host === "string" ? parsed.host : fallback.host,
      logFile: typeof parsed.logFile === "string" ? parsed.logFile : fallback.logFile,
      ingestToken: fallback.ingestToken,
      captureTextPreview: parsed.captureTextPreview === true,
      maxTextPreviewLength: Number.isInteger(parsed.maxTextPreviewLength)
        ? parsed.maxTextPreviewLength
        : fallback.maxTextPreviewLength,
    };
  } catch {
    return fallback;
  }
}

function modelToString(model) {
  if (!model) return null;
  if (typeof model === "string") return model;
  if (typeof model === "object") {
    const modelId = model.id ?? model.name ?? model.model;
    const provider = model.provider ?? model.providerId;
    if (provider && modelId) return `${provider}/${modelId}`;
    if (modelId) return String(modelId);
  }
  return String(model);
}

function normalizedConversationId(event, ctx, agentId, cwd) {
  const eventConversationId = typeof event.conversationId === "string" && event.conversationId.length > 0 ? event.conversationId : null;
  const contextConversationId = typeof ctx?.conversation?.id === "string" && ctx.conversation.id.length > 0 ? ctx.conversation.id : null;
  if (eventConversationId && eventConversationId !== "default") return eventConversationId;
  if (contextConversationId && contextConversationId !== "default") return contextConversationId;
  if (agentId) return `agent:${agentId}`;
  if ((eventConversationId === "default" || contextConversationId === "default") && cwd) return `workspace:${cwd}`;
  return eventConversationId ?? contextConversationId;
}

function baseEvent(type, event, ctx, data = {}) {
  const agentId = event.agentId ?? ctx?.agent?.id ?? null;
  const cwd = ctx?.cwd ?? null;
  return {
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    agentId,
    agentName: event.agentName ?? ctx?.agent?.name ?? null,
    conversationId: normalizedConversationId(event, ctx, agentId, cwd),
    cwd,
    model: modelToString(ctx?.model),
    permissionMode: ctx?.permissionMode ?? null,
    runtime: HOST_RUNTIME,
    data,
  };
}


function getCapabilities(letta) {
  return {
    events: {
      lifecycle: letta.capabilities.events?.lifecycle === true,
      turns: letta.capabilities.events?.turns === true,
      tools: letta.capabilities.events?.tools === true,
      compact: letta.capabilities.events?.compact === true,
      llm: letta.capabilities.events?.llm === true,
    },
    endpoints: {
      health: true,
      snapshot: true,
      sse: true,
      hookStop: true,
      hookAttention: true,
      ingest: true,
    },
    sessionActions: {
      focusTerminal: false,
      endSession: false,
      dismissEnded: true,
    },
  };
}

function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeLlmUsage(value) {
  if (!value || typeof value !== "object") return null;
  const promptTokens = numberOrNull(value.promptTokens);
  const completionTokens = numberOrNull(value.completionTokens);
  const rawTotalTokens = numberOrNull(value.totalTokens);
  const computedTotalTokens = promptTokens !== null && completionTokens !== null ? promptTokens + completionTokens : null;
  return {
    promptTokens,
    completionTokens,
    totalTokens: computedTotalTokens ?? rawTotalTokens,
  };
}

function normalizeLlmError(value) {
  if (!value || typeof value !== "object") return undefined;
  const message = typeof value.message === "string" ? value.message : null;
  const errorType = typeof value.errorType === "string" ? value.errorType : "llm_error";
  const retryable = typeof value.retryable === "boolean" ? value.retryable : null;
  if (!message) return undefined;
  return { message, errorType, retryable };
}

function postBridgeEvent(config, path, payload) {
  const body = JSON.stringify(payload);
  const req = request(
    {
      hostname: config.host,
      port: config.port,
      path,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...(path === "/ingest" ? { "x-agent-halo-token": config.ingestToken } : {}),
      },
      timeout: 500,
    },
    (res) => {
      res.resume();
    },
  );

  req.on("error", () => {
    // Primary bridge is unavailable; drop ambient presence event.
  });
  req.on("timeout", () => {
    req.destroy();
  });
  req.write(body);
  req.end();
}

function readRecentEvents(logFile, maxRecent) {
  try {
    if (!existsSync(logFile)) return [];
    return readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .slice(-maxRecent)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((event) => event && typeof event.type === "string" && typeof event.id === "string");
  } catch {
    return [];
  }
}

function getTextPreview(input, maxLength) {
  const parts = [];

  for (const item of Array.isArray(input) ? input : []) {
    if (item?.type === "approval") continue;
    if (item?.role !== "user") continue;

    if (typeof item.content === "string") {
      parts.push(item.content);
      continue;
    }

    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === "text" && typeof part.text === "string") {
          parts.push(part.text);
        }
      }
    }
  }

  const text = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function createBridge(letta, config) {
  mkdirSync(dirname(config.logFile), { recursive: true });

  const capabilities = getCapabilities(letta);
  const clients = new Set();
  const maxRecent = 500;
  const recent = readRecentEvents(config.logFile, maxRecent);
  const pendingEvents = [];
  let bridgeMode = "pending";
  const lastScope = {
    agentId: null,
    agentName: null,
    conversationId: null,
    cwd: null,
    model: null,
    permissionMode: null,
    runtime: null,
  };
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
    const staleActiveConversationIds = [];
    for (const [conversationId, record] of activeScopesByConversation) {
      if (now - record.lastActiveAt > activeScopeRetentionMs) staleActiveConversationIds.push(conversationId);
    }
    for (const conversationId of staleActiveConversationIds) removeActiveScope(conversationId);
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
    if (payload.type === "turn_start" || payload.type === "tool_start" || payload.type === "compact_start" || payload.type === "llm_start" || payload.type === "attention_requested") {
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
    if (payload.type === "turn_complete" || payload.type === "turn_stop" || payload.type === "conversation_close" || isTerminalLlmEvent(payload)) {
      if (payload.cwd) recentCompletionAtByCwd.set(payload.cwd, now);
      rememberCompletedScope(payload, now);
      removeActiveScope(payload.conversationId);
    }
  };

  const hookScope = (data, now) => {
    const requestedCwd = typeof data.cwd === "string" && data.cwd.length > 0
      ? data.cwd
      : typeof data.workingDirectory === "string" && data.workingDirectory.length > 0
        ? data.workingDirectory
        : null;
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

  const emitLocal = (payload, shouldRememberScope = true) => {
    if (shouldRememberScope) rememberScope(payload);
    recent.push(payload);
    if (recent.length > maxRecent) recent.shift();

    const serialized = JSON.stringify(payload);
    appendFileSync(config.logFile, `${serialized}\n`);

    const frame = `event: ${payload.type}\ndata: ${serialized}\n\n`;
    for (const res of clients) {
      try {
        res.write(frame);
      } catch {
        clients.delete(res);
      }
    }
  };

  const flushPendingEvents = () => {
    const queued = pendingEvents.splice(0, pendingEvents.length);
    for (const event of queued) {
      if (bridgeMode === "forward") {
        postBridgeEvent(config, "/ingest", event);
      } else {
        emitLocal(event, false);
      }
    }
  };

  const emit = (payload) => {
    rememberScope(payload);
    if (bridgeMode === "pending") {
      pendingEvents.push(payload);
      return;
    }
    if (bridgeMode === "forward") {
      postBridgeEvent(config, "/ingest", payload);
      return;
    }
    emitLocal(payload, false);
  };

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
  };

  const readJsonBody = (req) =>
    new Promise((resolve) => {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 16_384) {
          req.destroy();
          resolve({});
        }
      });
      req.on("end", () => {
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
      req.on("error", () => resolve({}));
    });

  const emitHookStop = (data = {}) => {
    const now = Date.now();
    const scope = hookScope(data, now);
    if (!shouldEmitHookSignal("turn_complete", scope, data, now)) return;
    emit({
      version: PROTOCOL_VERSION,
      id: randomUUID(),
      type: "turn_complete",
      timestamp: new Date().toISOString(),
      ...scope,
      data: {
        hookEventName: typeof data.hookEventName === "string" ? data.hookEventName : "Stop",
        source: typeof data.source === "string" ? data.source : "hook",
        message: typeof data.message === "string" ? data.message : null,
      },
    });
  };

  const emitHookAttention = (data = {}) => {
    const now = Date.now();
    const scope = hookScope(data, now);
    const isNotificationHook = data.hookEventName === "Notification";
    if (isNotificationHook && scope.cwd && now - (recentCompletionAtByCwd.get(scope.cwd) ?? 0) <= recentScopeRetentionMs) return;
    if (!shouldEmitHookSignal("attention_requested", scope, data, now)) return;
    emit({
      version: PROTOCOL_VERSION,
      id: randomUUID(),
      type: "attention_requested",
      timestamp: new Date().toISOString(),
      ...scope,
      data: {
        hookEventName: typeof data.hookEventName === "string" ? data.hookEventName : "PermissionRequest",
        source: typeof data.source === "string" ? data.source : "hook",
        kind: isNotificationHook ? "question" : "approval",
        toolName: typeof data.toolName === "string" ? data.toolName : null,
        message: typeof data.message === "string" ? data.message : null,
      },
    });
  };

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
      res.end(JSON.stringify({ ok: true, name: "agent-halo", version: PROTOCOL_VERSION, clients: clients.size, capabilities }));
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
      res.write(`: agent-halo connected ${new Date().toISOString()}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
    res.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  server.on("error", (error) => {
    bridgeMode = "forward";
    flushPendingEvents();
    letta.diagnostics?.report?.({
      severity: "warning",
      message: `Agent Halo bridge is already running or unavailable on ${config.host}:${config.port}; this mod instance will forward events to the primary bridge. (${error.message})`,
    });
  });

  server.listen(config.port, config.host, () => {
    bridgeMode = "server";
    emitLocal({
      version: PROTOCOL_VERSION,
      id: randomUUID(),
      type: "bridge_ready",
      timestamp: new Date().toISOString(),
      agentId: null,
      agentName: null,
      conversationId: null,
      cwd: null,
      model: null,
      permissionMode: null,
      runtime: HOST_RUNTIME,
      data: {
        port: config.port,
        logFile: config.logFile,
        ssePath: "/events",
        healthPath: "/health",
      },
    });
    flushPendingEvents();
  });

  return {
    emit,
    close() {
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // ignore cleanup errors
        }
      }
      clients.clear();
      server.close();
    },
  };
}

export default function activate(letta) {
  const disposers = [];
  const config = readConfig();
  const bridge = createBridge(letta, config);

  if (letta.capabilities.events?.lifecycle) {
    disposers.push(
      letta.events.on("conversation_open", (event, ctx) => {
        bridge.emit(
          baseEvent("conversation_open", event, ctx, {
            reason: event.reason,
            previousConversationId: event.previousConversationId ?? null,
          }),
        );
      }),
    );

    disposers.push(
      letta.events.on("conversation_close", (event, ctx) => {
        bridge.emit(
          baseEvent("conversation_close", event, ctx, {
            durationMs: event.durationMs ?? null,
            messageCount: event.messageCount ?? null,
            reason: event.reason,
            toolCallCount: event.toolCallCount ?? null,
          }),
        );
      }),
    );
  }

  if (letta.capabilities.events?.turns) {
    disposers.push(
      letta.events.on("turn_start", (event, ctx) => {
        const data = { inputCount: Array.isArray(event.input) ? event.input.length : 0 };
        if (config.captureTextPreview) {
          data.userTextPreview = getTextPreview(event.input, config.maxTextPreviewLength);
        }
        bridge.emit(baseEvent("turn_start", event, ctx, data));
      }),
    );
  }

  if (letta.capabilities.events?.tools) {
    disposers.push(
      letta.events.on("tool_start", (event, ctx) => {
        const toolEvent = baseEvent("tool_start", event, ctx, {
            toolCallId: event.toolCallId ?? null,
            toolName: event.toolName,
            argKeys: Object.keys(event.args ?? {}).sort(),
          });
        bridge.emit(toolEvent);
        if (String(event.toolName).toLowerCase() === "askuserquestion") {
          bridge.emit(
            baseEvent("attention_requested", event, ctx, {
              hookEventName: "AskUserQuestion",
              source: "tool",
              kind: "question",
              toolName: event.toolName,
              message: "Question",
            }),
          );
        }
      }),
    );

    disposers.push(
      letta.events.on("tool_end", (event, ctx) => {
        bridge.emit(
          baseEvent("tool_end", event, ctx, {
            toolCallId: event.toolCallId ?? null,
            toolName: event.toolName,
            status: event.status,
            outputLength: typeof event.output === "string" ? event.output.length : null,
          }),
        );
      }),
    );
  }

  if (letta.capabilities.events?.compact) {
    disposers.push(
      letta.events.on("compact_start", (event, ctx) => {
        bridge.emit(
          baseEvent("compact_start", event, ctx, {
            trigger: event.trigger,
          }),
        );
      }),
    );

    disposers.push(
      letta.events.on("compact_end", (event, ctx) => {
        bridge.emit(
          baseEvent("compact_end", event, ctx, {
            trigger: event.trigger,
            messagesBefore: typeof event.messagesBefore === "number" ? event.messagesBefore : null,
            messagesAfter: typeof event.messagesAfter === "number" ? event.messagesAfter : null,
            contextTokensBefore: typeof event.contextTokensBefore === "number" ? event.contextTokensBefore : null,
            contextTokensAfter: typeof event.contextTokensAfter === "number" ? event.contextTokensAfter : null,
          }),
        );
      }),
    );
  }

  if (letta.capabilities.events?.llm) {
    disposers.push(
      letta.events.on("llm_start", (event, ctx) => {
        const model = modelToString(event.model) ?? modelToString(ctx?.model) ?? "unknown-model";
        bridge.emit(
          baseEvent("llm_start", event, ctx, {
            model,
            messageCount: typeof event.messageCount === "number" ? event.messageCount : null,
            contextWindow: typeof event.contextWindow === "number" ? event.contextWindow : null,
          }),
        );
      }),
    );

    disposers.push(
      letta.events.on("llm_end", (event, ctx) => {
        const model = modelToString(event.model) ?? modelToString(ctx?.model) ?? "unknown-model";
        const usage = normalizeLlmUsage(event.usage);
        const error = normalizeLlmError(event.error);
        bridge.emit(
          baseEvent("llm_end", event, ctx, {
            model,
            stopReason: typeof event.stopReason === "string" ? event.stopReason : null,
            durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
            usage,
            ...(error ? { error } : {}),
          }),
        );
      }),
    );
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
    bridge.close();
  };
}
