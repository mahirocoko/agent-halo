import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

/**
 * Agent Halo AGY (Antigravity) Hook Adapter
 *
 * Translates AGY lifecycle hook events into AgentHaloEvent payloads and posts
 * them to the Agent Halo bridge. Invoked as a shell command from AGY's
 * hooks.json with `--event <EventType>` to identify the hook being fired.
 *
 * Usage:
 *   node agent-halo-agy-hook.mjs --event PreToolUse
 *   node agent-halo-agy-hook.mjs --event PostToolUse
 *   node agent-halo-agy-hook.mjs --event PreInvocation
 *   node agent-halo-agy-hook.mjs --event Stop
 *
 * AGY sends a JSON payload on stdin and expects a JSON response on stdout.
 * PreToolUse MUST return { "decision": "allow" } — empty {} is treated as deny.
 */

const DEFAULT_ENDPOINT = { hostname: "127.0.0.1", port: 47_621 };
const MOD_DIR = join(homedir(), ".letta", "mods");
const HOST_STARTED_AT_MS = Math.round(Date.now() - process.uptime() * 1_000);

/**
 * Resolve host identity for AGY.
 * Inspects process.ppid and ancestors to locate the running `agy` binary process
 * and its exact start time (for native libproc validation).
 */
const resolveHostIdentity = () => {
  let currentPid = Number.isInteger(process.ppid) && process.ppid > 1 ? process.ppid : null;
  let agyPid = null;
  let agyStartedAtMs = null;

  for (let depth = 0; depth < 5 && currentPid && currentPid > 1; depth++) {
    try {
      const out = execFileSync("ps", ["-p", String(currentPid), "-o", "ppid=,comm=,lstart="], {
        encoding: "utf8",
        timeout: 1000,
      }).trim();
      const match = out.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/);
      if (!match) break;
      const [, ppidStr, comm, lstart] = match;
      const lower = comm.toLowerCase();
      if (lower.endsWith("agy") || lower.includes("/agy")) {
        const parsed = Date.parse(lstart);
        agyPid = currentPid;
        agyStartedAtMs = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        break;
      }
      currentPid = parseInt(ppidStr, 10);
    } catch {
      break;
    }
  }

  if (agyPid) {
    return {
      sourcePid: agyPid,
      sourcePpid: Number.isInteger(process.ppid) && process.ppid > 0 ? process.ppid : null,
      sourceStartedAtMs: agyStartedAtMs ?? HOST_STARTED_AT_MS,
    };
  }

  const ppid = Number.isInteger(process.ppid) && process.ppid > 1 ? process.ppid : null;
  if (ppid) {
    try {
      const raw = execFileSync("ps", ["-p", String(ppid), "-o", "lstart="], {
        encoding: "utf8",
        timeout: 1000,
      }).trim();
      const parsed = Date.parse(raw);
      return {
        sourcePid: ppid,
        sourcePpid: ppid,
        sourceStartedAtMs: Number.isFinite(parsed) && parsed > 0 ? parsed : HOST_STARTED_AT_MS,
      };
    } catch {}
  }

  return {
    sourcePid: process.pid,
    sourcePpid: ppid,
    sourceStartedAtMs: HOST_STARTED_AT_MS,
  };
};

/** Read bridge endpoint from Agent Halo config. */
const readEndpoint = async () => {
  try {
    const config = JSON.parse(await readFile(join(MOD_DIR, "agent-halo.config.json"), "utf8"));
    const hostname = config.host === DEFAULT_ENDPOINT.hostname ? config.host : DEFAULT_ENDPOINT.hostname;
    const port = Number.isInteger(config.port) ? config.port : DEFAULT_ENDPOINT.port;
    if (port < 1 || port > 65_535) return DEFAULT_ENDPOINT;
    return { hostname, port };
  } catch {
    return DEFAULT_ENDPOINT;
  }
};

/** Read shared ingest token for trusted runtime identity. */
const readIngestToken = async () => {
  try {
    const value = (await readFile(join(MOD_DIR, "agent-halo.ingest-token"), "utf8")).trim();
    return /^[a-f0-9]{64}$/i.test(value) ? value : null;
  } catch {
    return null;
  }
};

/** Read JSON payload from stdin. */
const readInput = async () => {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  try {
    return body.trim() ? JSON.parse(body) : {};
  } catch {
    return {};
  }
};

/** POST a JSON payload to the Agent Halo bridge. */
const post = (endpoint, token, path, payload) =>
  new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const headers = {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    };
    if (token && path === "/ingest") {
      headers["x-agent-halo-token"] = token;
    }

    const req = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path,
        method: "POST",
        headers,
        timeout: 750,
      },
      (res) => {
        res.resume();
        resolve();
      },
    );
    req.on("error", resolve);
    req.on("timeout", () => {
      req.destroy();
      resolve();
    });
    req.end(body);
  });

/** Parse a CLI flag value, e.g. --event PreToolUse. */
const getCliArg = (flag) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
};

const main = async () => {
  const eventType = getCliArg("--event");

  // PreToolUse MUST return { decision: "allow" } — empty {} is treated as deny by AGY.
  const agyResponse = eventType === "PreToolUse" ? { decision: "allow" } : {};

  // Always output valid JSON to stdout so AGY does not block or error.
  const respond = () => {
    process.stdout.write(JSON.stringify(agyResponse) + "\n");
    process.exit(0);
  };

  try {
    if (!eventType) return respond();

    const input = await readInput();
    const endpoint = await readEndpoint();
    const token = await readIngestToken();

    const cwd = Array.isArray(input.workspacePaths) && input.workspacePaths.length > 0
      ? input.workspacePaths[0]
      : process.cwd();

    const conversationId = typeof input.conversationId === "string" && input.conversationId.length > 0
      ? input.conversationId
      : null;

    const model = typeof input.modelName === "string" && input.modelName.length > 0
      ? input.modelName
      : null;

    const hostIdentity = resolveHostIdentity();

    /** Build a protocol-v2 AgentHaloEvent envelope. */
    const buildEvent = (type, data = {}) => ({
      version: 2,
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      agentId: null,
      agentName: null,
      conversationId,
      cwd,
      model,
      permissionMode: null,
      runtime: {
        sourcePid: hostIdentity.sourcePid,
        sourcePpid: hostIdentity.sourcePpid,
        sourceStartedAtMs: hostIdentity.sourceStartedAtMs,
        sourceKind: "agyHost",
      },
      data,
    });

    const posts = [];

    if (eventType === "PreToolUse") {
      const toolName = input.toolCall?.name ?? "unknown";
      const argKeys = input.toolCall?.args ? Object.keys(input.toolCall.args).sort() : [];
      posts.push(post(endpoint, token, "/ingest", buildEvent("tool_start", {
        toolCallId: null,
        toolName,
        argKeys,
      })));
    } else if (eventType === "PostToolUse") {
      const status = input.error ? "error" : "success";
      posts.push(post(endpoint, token, "/ingest", buildEvent("tool_end", {
        toolCallId: null,
        toolName: input.toolCall?.name ?? "unknown",
        status,
        outputLength: null,
      })));
    } else if (eventType === "PreInvocation") {
      if (input.invocationNum === 0) {
        posts.push(post(endpoint, token, "/ingest", buildEvent("conversation_open", {
          reason: "startup",
          previousConversationId: null,
        })));
      }
      posts.push(post(endpoint, token, "/ingest", buildEvent("turn_start", {
        inputCount: 1,
      })));
    } else if (eventType === "Stop") {
      // Use the hook/stop endpoint like the Letta hook does.
      posts.push(post(endpoint, token, "/hook/stop", {
        hookId: randomUUID(),
        hookEventName: "Stop",
        source: "hook",
        workingDirectory: cwd,
        agentId: null,
        conversationId,
        toolName: null,
        message: typeof input.terminationReason === "string" ? input.terminationReason : null,
      }));
    }
    // PostInvocation: no direct event to emit; AGY will fire Stop when done.

    if (posts.length > 0) {
      await Promise.all(posts);
    }

    respond();
  } catch {
    // Ensure we always gracefully exit and unblock AGY.
    respond();
  }
};

main();
