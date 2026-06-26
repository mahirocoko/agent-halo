import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer, request } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const PROTOCOL_VERSION = 1;
const DEFAULT_PORT = 47621;
const MOD_DIR = join(homedir(), ".letta", "mods");
const CONFIG_PATH = join(MOD_DIR, "agent-halo.config.json");
const DEFAULT_LOG_FILE = join(MOD_DIR, "agent-halo.events.ndjson");

function readConfig() {
  const fallback = {
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    logFile: DEFAULT_LOG_FILE,
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

function baseEvent(type, event, ctx, data = {}) {
  return {
    version: PROTOCOL_VERSION,
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    agentId: event.agentId ?? ctx?.agent?.id ?? null,
    agentName: event.agentName ?? ctx?.agent?.name ?? null,
    conversationId: event.conversationId ?? ctx?.conversation?.id ?? null,
    cwd: ctx?.cwd ?? null,
    model: modelToString(ctx?.model),
    permissionMode: ctx?.permissionMode ?? null,
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
  };
  let lastWorkingScope = null;

  const cloneScope = (scope) => ({
    agentId: scope.agentId ?? null,
    agentName: scope.agentName ?? null,
    conversationId: scope.conversationId ?? null,
    cwd: scope.cwd ?? null,
    model: scope.model ?? null,
    permissionMode: scope.permissionMode ?? null,
  });

  const rememberScope = (payload) => {
    for (const key of Object.keys(lastScope)) {
      if (payload[key] != null) lastScope[key] = payload[key];
    }
    if (payload.type === "turn_start" || payload.type === "tool_start" || payload.type === "compact_start" || payload.type === "llm_start") {
      lastWorkingScope = cloneScope(lastScope);
    }
  };

  const hookScope = (data) => {
    const scope = cloneScope(lastWorkingScope ?? lastScope);
    for (const key of Object.keys(scope)) {
      if (typeof data[key] === "string" && data[key].length > 0) scope[key] = data[key];
    }
    return scope;
  };

  const emitLocal = (payload) => {
    rememberScope(payload);
    recent.push(payload);
    if (recent.length > maxRecent) recent.shift();

    const line = `${JSON.stringify(payload)}\n`;
    appendFileSync(config.logFile, line);

    const frame = `event: ${payload.type}\ndata: ${JSON.stringify(payload)}\n\n`;
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
        emitLocal(event);
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
    emitLocal(payload);
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
    emit({
      version: PROTOCOL_VERSION,
      id: randomUUID(),
      type: "turn_stop",
      timestamp: new Date().toISOString(),
      ...hookScope(data),
      data: {
        hookEventName: typeof data.hookEventName === "string" ? data.hookEventName : "Stop",
        source: typeof data.source === "string" ? data.source : "hook",
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
        emitLocal(body);
        res.writeHead(202, { "content-type": "application/json; charset=utf-8", ...corsHeaders });
        res.end(JSON.stringify({ ok: true, type: body.type }));
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
      res.end(JSON.stringify({ ok: true, type: "turn_stop" }));
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
        bridge.emit(
          baseEvent("tool_start", event, ctx, {
            toolCallId: event.toolCallId ?? null,
            toolName: event.toolName,
            argKeys: Object.keys(event.args ?? {}).sort(),
          }),
        );
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
        bridge.emit(
          baseEvent("llm_end", event, ctx, {
            model,
            stopReason: typeof event.stopReason === "string" ? event.stopReason : null,
            durationMs: typeof event.durationMs === "number" ? event.durationMs : null,
            usage,
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
