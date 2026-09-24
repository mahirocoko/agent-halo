import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'

const DEFAULT_ENDPOINT = { hostname: '127.0.0.1', port: 47_621 }
const MOD_DIR = join(homedir(), '.letta', 'mods')

export const readInput = async () => {
  let body = ''
  for await (const chunk of process.stdin) body += chunk
  try {
    return body.trim() ? JSON.parse(body) : {}
  } catch {
    return {}
  }
}

export const readEndpoint = async () => {
  try {
    const config = JSON.parse(await readFile(join(MOD_DIR, 'agent-halo.config.json'), 'utf8'))
    const hostname = config.host === DEFAULT_ENDPOINT.hostname ? config.host : DEFAULT_ENDPOINT.hostname
    const port = Number.isInteger(config.port) ? config.port : DEFAULT_ENDPOINT.port
    if (port < 1 || port > 65_535) return DEFAULT_ENDPOINT
    return { hostname, port }
  } catch {
    return DEFAULT_ENDPOINT
  }
}

export const readIngestToken = async () => {
  try {
    const value = (await readFile(join(MOD_DIR, 'agent-halo.ingest-token'), 'utf8')).trim()
    return /^[a-f0-9]{64}$/i.test(value) ? value : null
  } catch {
    return null
  }
}

export const postEvent = (endpoint, token, event) => new Promise((resolve) => {
  const body = JSON.stringify(event)
  const req = request(
    {
      ...endpoint,
      path: '/ingest',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(token ? { 'x-agent-halo-token': token } : {}),
      },
      timeout: 750,
    },
    (response) => {
      response.resume()
      resolve()
    },
  )
  req.on('error', resolve)
  req.on('timeout', () => {
    req.destroy()
    resolve()
  })
  req.end(body)
})

const firstString = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? null

export const resolveHostIdentity = (names) => {
  let currentPid = Number.isInteger(process.ppid) && process.ppid > 1 ? process.ppid : null
  const normalizedNames = names.map((name) => name.toLowerCase())

  for (let depth = 0; depth < 8 && currentPid && currentPid > 1; depth += 1) {
    try {
      const out = execFileSync('ps', ['-p', String(currentPid), '-o', 'ppid=,comm=,lstart='], {
        encoding: 'utf8',
        timeout: 1_000,
      }).trim()
      const match = out.match(/^\s*(\d+)\s+(\S+)\s+(.+)$/)
      if (!match) break
      const [, ppid, command, startedAt] = match
      const lower = command.toLowerCase()
      if (normalizedNames.some((name) => lower === name || lower.endsWith(`/${name}`))) {
        const parsed = Date.parse(startedAt)
        if (!Number.isFinite(parsed) || parsed <= 0) return null
        return {
          sourcePid: currentPid,
          sourcePpid: Number.isInteger(process.ppid) && process.ppid > 0 ? process.ppid : null,
          sourceStartedAtMs: parsed,
        }
      }
      currentPid = Number.parseInt(ppid, 10)
    } catch {
      break
    }
  }

  return null
}

export const createEvent = ({ sourceKind, hostNames, input, type, data = {}, provider }) => {
  const sessionId = firstString(input.session_id, input.sessionId, input.conversation_id, input.conversationId)
  if (!sessionId) return null
  const conversationId = `${provider.toLowerCase()}:${sessionId}`
  const cwd = firstString(input.cwd, input.working_directory, input.workingDirectory, input.workspacePath, input.workspace_roots?.[0]) ?? process.cwd()
  const model = firstString(input.model, input.model_name, input.modelName, input.model_id, input.modelId)
  const hostIdentity = resolveHostIdentity(hostNames)

  return {
    version: 2,
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    agentId: conversationId,
    agentName: provider,
    conversationId,
    cwd,
    model,
    permissionMode: null,
    runtime: hostIdentity ? { ...hostIdentity, sourceKind } : null,
    data,
  }
}

export const getHookEventName = (input) => firstString(input.hook_event_name, input.hookEventName, input.event)
export const getCliEventName = () => {
  const index = process.argv.indexOf('--event')
  return index > -1 ? firstString(process.argv[index + 1]) : null
}
export const getToolName = (input) => firstString(input.tool_name, input.toolName, input.tool?.name, input.toolCall?.name) ?? 'unknown'
export const getInputKeys = (input) => {
  const toolInput = input.tool_input ?? input.toolInput ?? input.tool?.input ?? input.toolCall?.args
  return toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? Object.keys(toolInput).sort() : []
}
