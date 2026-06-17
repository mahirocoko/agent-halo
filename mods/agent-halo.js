import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
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
    },
    endpoints: {
      health: true,
      snapshot: true,
      sse: true,
    },
    sessionActions: {
      focusTerminal: false,
      endSession: false,
      dismissEnded: true,
    },
  };
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
  const recent = [];
  const maxRecent = 100;

  const emit = (payload) => {
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

  const corsHeaders = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type, accept",
  };

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders);
      res.end();
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
    letta.diagnostics?.report?.({
      severity: "warning",
      message: `Agent Halo bridge failed on ${config.host}:${config.port}: ${error.message}`,
    });
  });

  server.listen(config.port, config.host, () => {
    emit({
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

  if (letta.capabilities.ui?.statusValues) {
    letta.ui.setStatus("agent-halo", `:${config.port}`);
    disposers.push(() => letta.ui.clearStatus("agent-halo"));
  }

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
  }

  return () => {
    for (const dispose of disposers.reverse()) dispose();
    bridge.close();
  };
}
