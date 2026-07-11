import { request } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_ENDPOINT = { hostname: "127.0.0.1", port: 47_621 };

const readEndpoint = async () => {
  try {
    const config = JSON.parse(await readFile(join(homedir(), ".letta", "mods", "agent-halo.config.json"), "utf8"));
    const hostname = typeof config.host === "string" ? config.host : DEFAULT_ENDPOINT.hostname;
    const port = Number.isInteger(config.port) ? config.port : DEFAULT_ENDPOINT.port;
    if (!["127.0.0.1", "::1", "localhost"].includes(hostname) || port < 1 || port > 65_535) return DEFAULT_ENDPOINT;
    return { hostname, port };
  } catch {
    return DEFAULT_ENDPOINT;
  }
};

const readInput = async () => {
  let body = "";
  for await (const chunk of process.stdin) body += chunk;
  try {
    return body.trim() ? JSON.parse(body) : {};
  } catch {
    return {};
  }
};

const post = (endpoint, path, payload) =>
  new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
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

const input = await readInput();
const endpoint = await readEndpoint();
const eventName = input.event_type ?? process.env.LETTA_HOOK_EVENT ?? "";
const payload = {
  hookId: randomUUID(),
  hookEventName: eventName,
  source: "hook",
  workingDirectory: input.working_directory ?? process.env.LETTA_WORKING_DIR ?? process.env.USER_CWD ?? process.cwd(),
  agentId: input.agent_id ?? process.env.LETTA_AGENT_ID ?? process.env.AGENT_ID ?? null,
  conversationId: input.conversation_id ?? process.env.LETTA_CONVERSATION_ID ?? process.env.CONVERSATION_ID ?? null,
  toolName: input.tool_name ?? input.permission?.type ?? null,
  message: typeof input.message === "string" ? input.message : null,
};

if (eventName === "PermissionRequest" || eventName === "Notification") {
  await post(endpoint, "/hook/attention", payload);
} else if (eventName === "Stop") {
  await post(endpoint, "/hook/stop", payload);
}
