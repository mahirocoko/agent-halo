import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  Download,
  ExternalLink,
  Focus,
  List,
  RefreshCw,
  Settings,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import {
  createDefaultBridgeCapabilities,
  createInitialPresence,
  getPresenceView,
  reducePresence,
  type AgentHaloEvent,
  type AgentHaloPresenceStatus,
  type IAgentHaloBridgeCapabilities,
  type IAgentHaloPresence,
} from "@agent-halo/protocol";
import "./styles.css";

const BRIDGE_URL = "http://127.0.0.1:47621";
const DEFAULT_USAGE_REFRESH_MS = 15 * 60_000;
const USAGE_SETTINGS_STORAGE_KEY = "agent-halo.usage-settings";
const STALE_AFTER_MS = 30_000;
const MAX_RECENT_EVENTS = 80;
const MAX_SESSION_EVENTS_PER_SESSION = 32;
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const DEFAULT_CAMERA_NOTCH_WIDTH = 184;
const DEFAULT_CLOSED_NOTCH_HEIGHT = 36;
const MIN_LIVE_ACTIVITY_WING_WIDTH = 66;
const MAX_LIVE_ACTIVITY_WING_WIDTH = 110;
const LIVE_ACTIVITY_TEXT_WIDTH_BUFFER = 52;
const PILL_WINDOW_HEIGHT = 42;
const PANEL_WINDOW_WIDTH = 560;
const PANEL_MIN_HEIGHT = 218;
const PANEL_MAX_HEIGHT = 440;
const ACTIVITY_COLLAPSE_MS = 220;
const HOVER_OPEN_DELAY_MS = 24;
const HOVER_CLOSE_DELAY_MS = 170;
const CLOSED_TOP_SHOULDER_RADIUS = 11;
const OPEN_TOP_SHOULDER_RADIUS = 19;
const CLOSED_BOTTOM_RADIUS = 15;
const PANEL_BOTTOM_RADIUS = 22;
const DISMISSED_SESSIONS_STORAGE_KEY = "agent-halo.dismissed-sessions";
const DELETED_SESSIONS_STORAGE_KEY = "agent-halo.deleted-sessions";
const SESSION_EVENTS_STORAGE_KEY = "agent-halo.session-events";

interface IConnectionState {
  status: "connecting" | "connected" | "disconnected" | "error";
  message: string | null;
}

interface INativeActionState {
  bridgeOnline: boolean | null;
  message: string | null;
}

interface ISessionActionState {
  ok: boolean | null;
  message: string | null;
}

interface IModStatus {
  path: string | null;
  installed: boolean | null;
}

interface INotchMetrics {
  cameraWidth: number;
  closedHeight: number;
}

interface ISessionSummary {
  conversationId: string;
  project: string;
  workspace: string;
  workspacePath: string | null;
  detail: string;
  activityKind: ActivityKind;
  status: "idle" | "working" | "waiting" | "done" | "error";
  lastActivityAt: string;
}

interface ISessionDetail extends ISessionSummary {
  agentName: string;
  cwd: string;
  model: string;
  permissionMode: string;
  events: AgentHaloEvent[];
}

type ActivityKind =
  | "session"
  | "thinking"
  | "planning"
  | "tool"
  | "shell"
  | "editing"
  | "delegating"
  | "visual"
  | "memory"
  | "asking"
  | "skill"
  | "goal"
  | "done"
  | "error"
  | "bridge";

interface IActivityDescriptor {
  kind: ActivityKind;
  label: string;
  detail: string;
}

interface IWorkspaceSessionGroup {
  key: string;
  project: string;
  workspace: string;
  workspacePath: string | null;
  status: ISessionSummary["status"];
  activityKind: ActivityKind;
  detail: string;
  lastActivityAt: string;
  primarySession: ISessionSummary;
  sessions: ISessionSummary[];
}

type SessionEventRegistry = Record<string, AgentHaloEvent[]>;
type DismissedSessionRegistry = Record<string, number>;
type DeletedSessionRegistry = Record<string, number>;

type UsageProviderId = "codex" | "agy" | "claude" | "cursor" | "grok";
type MainPanelTab = "sessions" | "usage";
type UsageMode = "left" | "used";
type UsageResetMode = "relative" | "absolute";
type UsageTimeFormat = "auto" | "12h" | "24h";
type UsageSidebarSelection = UsageProviderId | "settings";

interface IUsageProviderConfig {
  id: UsageProviderId;
  label: string;
  command: "codex_usage" | "agy_usage" | "claude_usage" | "cursor_usage" | "grok_usage";
  iconPath: string;
  color: string;
  links?: Array<{ label: string; url: string }>;
}

interface IUsageSettings {
  refreshMs: number;
  usageMode: UsageMode;
  resetMode: UsageResetMode;
  timeFormat: UsageTimeFormat;
}

interface IUsageMetricLine {
  type: "text" | "progress" | "badge" | "barChart" | string;
  label: string;
  used?: number;
  limit?: number;
  value?: string;
  text?: string;
  points?: IUsageChartPoint[];
  note?: string;
  color?: string;
  resetsAt?: string;
}

interface IUsageChartPoint {
  label: string;
  value: number;
  valueLabel?: string;
}

interface IAgentUsageSnapshot {
  providerId: string;
  displayName?: string;
  plan?: string | null;
  lines?: IUsageMetricLine[];
  fetchedAt?: string;
}

interface IUsageMetric {
  label: string;
  groupLabel: string | null;
  groupModels: string[];
  limitLabel: string | null;
  value: number | null;
  statusLevel: "ok" | "warning" | "danger";
  remainingLabel: string | null;
  resetLabel: string | null;
}

interface IUsageMetricGroup {
  label: string;
  models: string[];
  metrics: IUsageMetric[];
}

interface IAgentUsageState {
  status: "loading" | "online" | "offline" | "error";
  providerId: UsageProviderId;
  message: string | null;
  fetchedAt: string | null;
  plan: string | null;
  metrics: IUsageMetric[];
  sessionPercent: number | null;
  weeklyPercent: number | null;
  reviewsPercent: number | null;
  rateLimitResets: string | null;
  credits: string | null;
  today: string | null;
  yesterday: string | null;
  latestTokenLog: string | null;
  last30Days: string | null;
  usageTrend: IUsageMetricLine | null;
  dailyTokenRows: Array<{ label: string; value: string }>;
  modelShares: Array<{ label: string; value: string }>;
}

const USAGE_PROVIDERS: IUsageProviderConfig[] = [
  {
    id: "codex",
    label: "Codex",
    command: "codex_usage",
    iconPath: "/provider-icons/codex.svg",
    color: "#10a37f",
    links: [
      { label: "Status", url: "https://status.openai.com/" },
      { label: "Usage dashboard", url: "https://chatgpt.com/codex/settings/usage" },
    ],
  },
  { id: "agy", label: "Antigravity", command: "agy_usage", iconPath: "/provider-icons/antigravity.svg", color: "#4285f4" },
  {
    id: "claude",
    label: "Claude Code",
    command: "claude_usage",
    iconPath: "/provider-icons/claude.svg",
    color: "#d97757",
    links: [
      { label: "Status", url: "https://status.anthropic.com/" },
      { label: "Console", url: "https://console.anthropic.com/" },
    ],
  },
  {
    id: "cursor",
    label: "Cursor",
    command: "cursor_usage",
    iconPath: "/provider-icons/cursor.svg",
    color: "#ffffff",
    links: [
      { label: "Status", url: "https://status.cursor.com/" },
      { label: "Dashboard", url: "https://www.cursor.com/dashboard" },
    ],
  },
  {
    id: "grok",
    label: "Grok",
    command: "grok_usage",
    iconPath: "/provider-icons/grok.svg",
    color: "#d9d9d9",
    links: [
      { label: "Usage", url: "https://grok.com/?_s=usage" },
    ],
  },
];

const DEFAULT_USAGE_SETTINGS: IUsageSettings = {
  refreshMs: DEFAULT_USAGE_REFRESH_MS,
  usageMode: "left",
  resetMode: "relative",
  timeFormat: "auto",
};

const estimateLiveActivityWingWidth = (label: string): number => {
  const textWidth = Math.ceil(label.length * 5.6);
  return Math.min(MAX_LIVE_ACTIVITY_WING_WIDTH, Math.max(MIN_LIVE_ACTIVITY_WING_WIDTH, LIVE_ACTIVITY_TEXT_WIDTH_BUFFER + textWidth));
};

const buildNotchShapePath = (width: number, height: number, topRadius: number, bottomRadius: number): string => {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const top = Math.min(Math.max(0, topRadius), safeWidth / 2, safeHeight / 2);
  const bottom = Math.min(Math.max(0, bottomRadius), safeWidth / 2, safeHeight / 2);

  return [
    `M 0 0`,
    `Q ${top} 0 ${top} ${top}`,
    `L ${top} ${safeHeight - bottom}`,
    `Q ${top} ${safeHeight} ${top + bottom} ${safeHeight}`,
    `L ${safeWidth - top - bottom} ${safeHeight}`,
    `Q ${safeWidth - top} ${safeHeight} ${safeWidth - top} ${safeHeight - bottom}`,
    `L ${safeWidth - top} ${top}`,
    `Q ${safeWidth - top} 0 ${safeWidth} 0`,
    "Z",
  ].join(" ");
};

const waitForNextPaint = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

const clampPanelHeight = (value: number): number => Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.ceil(value)));

interface IStatusView {
  status: AgentHaloPresenceStatus | "stale";
  label: string;
  isStale: boolean;
  staleForMs: number;
}

const isSessionEventRegistry = (value: unknown): value is SessionEventRegistry =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (events) =>
      Array.isArray(events) &&
      events.every(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          typeof (event as AgentHaloEvent).id === "string" &&
          typeof (event as AgentHaloEvent).timestamp === "string" &&
          typeof (event as AgentHaloEvent).conversationId === "string",
      ),
  );

const readSessionEventRegistry = (): SessionEventRegistry => {
  try {
    const raw = window.localStorage.getItem(SESSION_EVENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return isSessionEventRegistry(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeSessionEventRegistry = (registry: SessionEventRegistry) => {
  try {
    window.localStorage.setItem(SESSION_EVENTS_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Ignore storage errors; the in-memory registry still prevents SSE/recent-window churn.
  }
};

const readDismissedSessionIds = (): DismissedSessionRegistry => {
  try {
    const raw = window.localStorage.getItem(DISMISSED_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return Object.fromEntries(parsed.filter((item): item is string => typeof item === "string").map((id) => [id, 0]));
    }
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
};

const writeDismissedSessionIds = (registry: DismissedSessionRegistry) => {
  try {
    window.localStorage.setItem(DISMISSED_SESSIONS_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Ignore storage errors; dismissal still works for the current runtime session.
  }
};

const readDeletedSessionIds = (): DeletedSessionRegistry => {
  try {
    const raw = window.localStorage.getItem(DELETED_SESSIONS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, number] => typeof entry[0] === "string" && typeof entry[1] === "number"),
    );
  } catch {
    return {};
  }
};

const writeDeletedSessionIds = (registry: DeletedSessionRegistry) => {
  try {
    window.localStorage.setItem(DELETED_SESSIONS_STORAGE_KEY, JSON.stringify(registry));
  } catch {
    // Ignore storage errors; the deleted tombstone still works for the current runtime session.
  }
};

const isUsageMode = (value: unknown): value is UsageMode => value === "left" || value === "used";
const isUsageResetMode = (value: unknown): value is UsageResetMode => value === "relative" || value === "absolute";
const isUsageTimeFormat = (value: unknown): value is UsageTimeFormat => value === "auto" || value === "12h" || value === "24h";
const isRefreshMs = (value: unknown): value is number => typeof value === "number" && [5, 15, 30, 60].includes(value / 60_000);

const readUsageSettings = (): IUsageSettings => {
  try {
    const raw = window.localStorage.getItem(USAGE_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_USAGE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<IUsageSettings>;
    return {
      refreshMs: isRefreshMs(parsed.refreshMs) ? parsed.refreshMs : DEFAULT_USAGE_SETTINGS.refreshMs,
      usageMode: isUsageMode(parsed.usageMode) ? parsed.usageMode : DEFAULT_USAGE_SETTINGS.usageMode,
      resetMode: isUsageResetMode(parsed.resetMode) ? parsed.resetMode : DEFAULT_USAGE_SETTINGS.resetMode,
      timeFormat: isUsageTimeFormat(parsed.timeFormat) ? parsed.timeFormat : DEFAULT_USAGE_SETTINGS.timeFormat,
    };
  } catch {
    return DEFAULT_USAGE_SETTINGS;
  }
};

const writeUsageSettings = (settings: IUsageSettings) => {
  try {
    window.localStorage.setItem(USAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors; settings still apply for the current runtime session.
  }
};

const isDismissedAfter = (registry: DismissedSessionRegistry, conversationId: string | null | undefined, latestEventAt: string | null | undefined): boolean => {
  if (!conversationId || !latestEventAt) return false;
  const dismissedAt = registry[conversationId];
  if (typeof dismissedAt !== "number") return false;
  const latestEventMs = Date.parse(latestEventAt);
  if (!Number.isFinite(latestEventMs)) return false;
  return dismissedAt >= latestEventMs;
};

const isDeletedAfter = (registry: DeletedSessionRegistry, conversationId: string | null | undefined, latestEventAt: string | null | undefined): boolean => {
  if (!conversationId || !latestEventAt) return false;
  const deletedAt = registry[conversationId];
  if (typeof deletedAt !== "number") return false;
  const latestEventMs = Date.parse(latestEventAt);
  if (!Number.isFinite(latestEventMs)) return false;
  return deletedAt >= latestEventMs;
};

const shortenPath = (path: string | null | undefined): string => {
  if (!path) return "No workspace";
  const home = window.__AGENT_HALO_HOME__ ?? "";
  const normalized = home ? path.replace(home, "~") : path;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) return normalized;
  return `…/${segments.slice(-3).join("/")}`;
};

const projectName = (path: string | null | undefined): string => {
  if (!path) return "Agent Halo";
  return path.split("/").filter(Boolean).at(-1) ?? "Agent Halo";
};

const isInternalWorkspacePath = (path: string | null | undefined): boolean => {
  if (!path) return false;
  return path.includes("/.letta/lc-local-backend/memfs/") || path.includes("/.letta/mod-cache/") || path.endsWith("/.letta/mods") || path.endsWith("/memory");
};

const getSessionWorkspacePath = (events: AgentHaloEvent[], fallbackPath?: string | null): string | null => {
  const preferred = events.find((event) => event.cwd && !isInternalWorkspacePath(event.cwd));
  if (preferred?.cwd) return preferred.cwd;
  return fallbackPath && !isInternalWorkspacePath(fallbackPath) ? fallbackPath : null;
};

const isInternalOnlySession = (events: AgentHaloEvent[]): boolean =>
  events.length > 0 && events.every((event) => !event.cwd || isInternalWorkspacePath(event.cwd));

const sortEventsNewestFirst = (events: AgentHaloEvent[]): AgentHaloEvent[] =>
  [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

const mergeSessionEvents = (current: SessionEventRegistry, incoming: AgentHaloEvent[]): SessionEventRegistry => {
  if (incoming.length === 0) return current;

  const next: SessionEventRegistry = { ...current };

  for (const event of incoming) {
    if (!event.conversationId) continue;
    const existing = next[event.conversationId] ?? [];
    const byId = new Map<string, AgentHaloEvent>();
    for (const item of existing) byId.set(item.id, item);
    byId.set(event.id, event);
    next[event.conversationId] = sortEventsNewestFirst([...byId.values()]).slice(0, MAX_SESSION_EVENTS_PER_SESSION);
  }

  return next;
};

const flattenSessionEvents = (registry: SessionEventRegistry): AgentHaloEvent[] =>
  sortEventsNewestFirst(Object.values(registry).flat());

const formatTime = (timestamp: string | null): string => {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
};

const getToolActivityKind = (toolName: string): ActivityKind => {
  if (toolName === "UpdatePlan") return "planning";
  if (toolName === "exec_command" || toolName === "write_stdin" || toolName === "TaskOutput" || toolName === "TaskStop") return "shell";
  if (toolName === "ApplyPatch") return "editing";
  if (toolName === "Agent" || toolName === "Task") return "delegating";
  if (toolName === "ViewImage") return "visual";
  if (toolName === "memory_apply_patch") return "memory";
  if (toolName === "AskUserQuestion") return "asking";
  if (toolName === "Skill") return "skill";
  if (toolName === "CreateGoal" || toolName === "UpdateGoal" || toolName === "GetGoal") return "goal";
  return "tool";
};

const getToolActivityLabel = (kind: ActivityKind): string => {
  switch (kind) {
    case "planning":
      return "plan";
    case "shell":
      return "shell";
    case "editing":
      return "edit";
    case "delegating":
      return "agent";
    case "visual":
      return "visual";
    case "memory":
      return "memory";
    case "asking":
      return "ask";
    case "skill":
      return "skill";
    case "goal":
      return "goal";
    default:
      return "tool";
  }
};

const getToolActivityDetail = (toolName: string): string => {
  switch (toolName) {
    case "UpdatePlan":
      return "update plan";
    case "UpdateGoal":
      return "update goal";
    case "GetGoal":
      return "read goal";
    case "CreateGoal":
      return "create goal";
    case "exec_command":
      return "command";
    case "write_stdin":
      return "terminal input";
    case "TaskOutput":
      return "task output";
    case "TaskStop":
      return "stop task";
    case "ApplyPatch":
      return "patch files";
    case "Agent":
    case "Task":
      return "subagent task";
    case "ViewImage":
      return "inspect image";
    case "memory_apply_patch":
      return "write memory";
    case "AskUserQuestion":
      return "ask user";
    case "Skill":
      return "run skill";
    default:
      return toolName;
  }
};

const getEventActivity = (event: AgentHaloEvent): IActivityDescriptor => {
  switch (event.type) {
    case "bridge_ready":
      return { kind: "bridge", label: "bridge", detail: `:${event.data.port}` };
    case "conversation_open":
      return { kind: "session", label: "open", detail: event.data.reason };
    case "conversation_close":
      return { kind: "done", label: "closed", detail: event.data.reason };
    case "turn_start":
      return { kind: "thinking", label: "thinking", detail: `${event.data.inputCount} input` };
    case "turn_stop":
      return { kind: "done", label: "done", detail: event.data.message ?? "turn complete" };
    case "tool_start": {
      const kind = getToolActivityKind(event.data.toolName);
      return { kind, label: getToolActivityLabel(kind), detail: getToolActivityDetail(event.data.toolName) };
    }
    case "bridge_error":
      return { kind: "error", label: "error", detail: event.data.message };
  }
};

const getUniqueSortedEvents = (events: AgentHaloEvent[]): AgentHaloEvent[] => {
  const byId = new Map<string, AgentHaloEvent>();
  for (const event of events) byId.set(event.id, event);
  return sortEventsNewestFirst([...byId.values()]);
};


const clampPercent = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
};

const findUsageLine = (lines: IUsageMetricLine[], label: string): IUsageMetricLine | null =>
  lines.find((line) => line.label.toLowerCase() === label.toLowerCase()) ?? null;

const readProgressPercent = (line: IUsageMetricLine | null): number | null => {
  if (!line || line.type !== "progress" || typeof line.used !== "number") return null;
  if (typeof line.limit === "number" && line.limit > 0 && line.limit !== 100) return clampPercent((line.used / line.limit) * 100);
  return clampPercent(line.used);
};

const readTextValue = (line: IUsageMetricLine | null): string | null => {
  if (!line) return null;
  if (typeof line.value === "string" && line.value.trim()) return line.value.trim();
  if (typeof line.text === "string" && line.text.trim()) return line.text.trim();
  return null;
};

const CODEX_KNOWN_TEXT_LABELS = new Set(["rate limit resets", "credits", "today", "yesterday", "latest token log", "last 30 days"]);

const readCodexModelShares = (lines: IUsageMetricLine[]): Array<{ label: string; value: string }> =>
  lines
    .filter((line) => line.type === "text" && !CODEX_KNOWN_TEXT_LABELS.has(line.label.toLowerCase()))
    .filter((line) => !line.label.toLowerCase().startsWith("daily "))
    .map((line) => ({ label: line.label, value: readTextValue(line) ?? "" }))
    .filter((line) => /%$/.test(line.value));

const readCodexDailyTokenRows = (lines: IUsageMetricLine[]): Array<{ label: string; value: string }> =>
  lines
    .filter((line) => line.type === "text" && line.label.toLowerCase().startsWith("daily "))
    .map((line) => ({ label: line.label.replace(/^Daily\s+/i, ""), value: readTextValue(line) ?? "" }))
    .filter((line) => line.value.length > 0);


const formatDurationShort = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const formatAbsoluteTime = (timestamp: string, format: UsageTimeFormat): string | null => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return null;
  const hour12 = format === "auto" ? undefined : format === "12h";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12,
  }).format(date);
};

const formatResetLabel = (resetsAt: string | undefined, settings: IUsageSettings): string | null => {
  if (!resetsAt) return null;
  if (settings.resetMode === "absolute") {
    const time = formatAbsoluteTime(resetsAt, settings.timeFormat);
    return time ? `Reset at ${time}` : null;
  }
  const resetMs = Date.parse(resetsAt);
  if (!Number.isFinite(resetMs)) return null;
  const delta = resetMs - Date.now();
  if (delta <= 0) return "Reset soon";
  return `Resets in ${formatDurationShort(delta)}`;
};

const ANTIGRAVITY_USAGE_GROUPS: IUsageMetricGroup[] = [
  { label: "Gemini models", models: ["Gemini Flash", "Gemini Pro"], metrics: [] },
  { label: "Claude and GPT models", models: ["Claude Opus", "Claude Sonnet", "GPT-OSS"], metrics: [] },
];

const normalizeUsageGroupLabel = (label: string): string | null => {
  const lower = label.toLowerCase();
  if (lower.includes("gemini")) return "Gemini models";
  if (lower.includes("claude") || lower.includes("gpt")) return "Claude and GPT models";
  return null;
};

const modelsForUsageGroup = (groupLabel: string | null): string[] =>
  ANTIGRAVITY_USAGE_GROUPS.find((group) => group.label === groupLabel)?.models ?? [];

const limitLabelForUsageLine = (line: IUsageMetricLine, groupLabel: string | null): string | null => {
  if (!groupLabel) return null;
  const lower = line.label.toLowerCase();
  if (lower.includes("five") || lower.includes("5h")) return "Five Hour Limit";
  return "Weekly Limit";
};

const createUsageMetric = (line: IUsageMetricLine, settings: IUsageSettings): IUsageMetric => {
  const used = readProgressPercent(line);
  const left = used === null ? null : Math.max(0, 100 - used);
  const value = settings.usageMode === "used" ? used : left;
  const groupLabel = normalizeUsageGroupLabel(line.label);
  const limitLabel = limitLabelForUsageLine(line, groupLabel);
  const isQuotaAvailable = groupLabel !== null && limitLabel === "Five Hour Limit" && settings.usageMode === "left" && left === 100;
  const statusLevel = used === null
    ? "ok"
    : settings.usageMode === "used"
      ? used >= 80 ? "danger" : used >= 55 ? "warning" : "ok"
      : left !== null && left <= 20 ? "danger" : left !== null && left <= 45 ? "warning" : "ok";
  return {
    label: line.label,
    groupLabel,
    groupModels: modelsForUsageGroup(groupLabel),
    limitLabel,
    value,
    statusLevel,
    remainingLabel: isQuotaAvailable ? "Quota available" : value === null ? null : `${value}% ${groupLabel && settings.usageMode === "left" ? "remaining" : settings.usageMode}`,
    resetLabel: isQuotaAvailable ? null : formatResetLabel(line.resetsAt, settings),
  };
};

const createAgentUsageState = (providerId: UsageProviderId, partial: Partial<IAgentUsageState> = {}): IAgentUsageState => ({
  status: "loading",
  providerId,
  message: null,
  fetchedAt: null,
  plan: null,
  metrics: [],
  sessionPercent: null,
  weeklyPercent: null,
  reviewsPercent: null,
  rateLimitResets: null,
  credits: null,
  today: null,
  yesterday: null,
  latestTokenLog: null,
  last30Days: null,
  usageTrend: null,
  dailyTokenRows: [],
  modelShares: [],
  ...partial,
});

const parseAgentUsageSnapshot = (providerId: UsageProviderId, snapshot: IAgentUsageSnapshot, settings: IUsageSettings): IAgentUsageState => {
  const lines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const metrics = lines
    .filter((line) => line.type === "progress")
    .map((line) => createUsageMetric(line, settings));

  return createAgentUsageState(providerId, {
    status: "online",
    message: null,
    fetchedAt: snapshot.fetchedAt ?? new Date().toISOString(),
    plan: snapshot.plan ?? null,
    metrics,
    sessionPercent: readProgressPercent(findUsageLine(lines, "Session")),
    weeklyPercent: readProgressPercent(findUsageLine(lines, "Weekly")),
    reviewsPercent: readProgressPercent(findUsageLine(lines, "Reviews")),
    rateLimitResets: readTextValue(findUsageLine(lines, "Rate Limit Resets")),
    credits: readTextValue(findUsageLine(lines, "Credits")),
    today: readTextValue(findUsageLine(lines, "Today")),
    yesterday: readTextValue(findUsageLine(lines, "Yesterday")),
    latestTokenLog: readTextValue(findUsageLine(lines, "Latest Token Log")),
    last30Days: readTextValue(findUsageLine(lines, "Last 30 Days")),
    usageTrend: lines.find((line) => line.type === "barChart" && line.label.toLowerCase() === "usage trend") ?? null,
    dailyTokenRows: providerId === "codex" ? readCodexDailyTokenRows(lines) : [],
    modelShares: providerId === "codex" ? readCodexModelShares(lines) : [],
  });
};

const getEventDetail = (event: AgentHaloEvent): string => {
  const activity = getEventActivity(event);
  return `${activity.label} · ${activity.detail}`;
};

const getStatusCopy = (view: IStatusView): string => {
  const statusCopy: Record<IStatusView["status"], string> = {
    offline: "Bridge offline",
    idle: "Agent idle",
    thinking: "Thinking",
    "tool-running": "Using tool",
    stale: "Still running?",
    closed: "Done",
    error: "Bridge error",
  };

  return statusCopy[view.status] ?? view.label;
};

const getGlyphStatus = (status: IStatusView["status"]): ISessionSummary["status"] => {
  switch (status) {
    case "thinking":
    case "tool-running":
      return "working";
    case "stale":
      return "waiting";
    case "closed":
      return "done";
    case "error":
    case "offline":
      return "error";
    default:
      return "idle";
  }
};

const getEventSessionStatus = (event: AgentHaloEvent, now: Date = new Date()): ISessionSummary["status"] => {
  switch (event.type) {
    case "conversation_close":
    case "turn_stop":
      return "done";
    case "turn_start":
    case "tool_start":
      return now.getTime() - Date.parse(event.timestamp) > STALE_AFTER_MS ? "waiting" : "working";
    case "bridge_error":
      return "error";
    default:
      return "idle";
  }
};

const sessionStatusPriority: Record<ISessionSummary["status"], number> = {
  error: 5,
  working: 4,
  waiting: 3,
  done: 2,
  idle: 1,
};

const compareSessionsByActivity = (a: ISessionSummary, b: ISessionSummary): number => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);

const getWorkspaceGroupKey = (session: ISessionSummary): string => session.workspacePath ? `cwd:${session.workspacePath}` : `session:${session.conversationId}`;

const buildWorkspaceSessionGroups = (sessions: ISessionSummary[]): IWorkspaceSessionGroup[] => {
  const grouped = new Map<string, ISessionSummary[]>();

  for (const session of sessions) {
    const key = getWorkspaceGroupKey(session);
    grouped.set(key, [...(grouped.get(key) ?? []), session]);
  }

  return [...grouped.entries()]
    .map(([key, groupSessions]) => {
      const sortedSessions = [...groupSessions].sort((a, b) => {
        const statusDelta = sessionStatusPriority[b.status] - sessionStatusPriority[a.status];
        return statusDelta !== 0 ? statusDelta : compareSessionsByActivity(a, b);
      });
      const primarySession = sortedSessions[0];
      const latestSession = [...groupSessions].sort(compareSessionsByActivity)[0] ?? primarySession;
      const status = primarySession.status;
      const activeCount = groupSessions.filter((session) => session.status === "working" || session.status === "waiting").length;
      const doneCount = groupSessions.filter((session) => session.status === "done").length;
      const detail = activeCount > 0
        ? `${activeCount} active · ${groupSessions.length} sessions`
        : doneCount === groupSessions.length
          ? `${doneCount} done sessions`
          : `${groupSessions.length} sessions`;

      return {
        key,
        project: primarySession.project,
        workspace: primarySession.workspace,
        workspacePath: primarySession.workspacePath,
        status,
        activityKind: primarySession.activityKind,
        detail,
        lastActivityAt: latestSession.lastActivityAt,
        primarySession,
        sessions: groupSessions.sort(compareSessionsByActivity),
      } satisfies IWorkspaceSessionGroup;
    })
    .sort((a, b) => {
      const statusDelta = sessionStatusPriority[b.status] - sessionStatusPriority[a.status];
      return statusDelta !== 0 ? statusDelta : Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
    });
};

const MASCOT_THEMES = [
  { fur: "rgba(246, 246, 238, 0.96)", haloLeft: "#ff9d3d", haloRight: "#4ade80", line: "rgba(12, 12, 14, 0.75)" },
  { fur: "rgba(238, 244, 255, 0.96)", haloLeft: "#ffb23d", haloRight: "#7dd3fc", line: "rgba(13, 18, 28, 0.72)" },
  { fur: "rgba(255, 240, 222, 0.96)", haloLeft: "#fb7185", haloRight: "#4ade80", line: "rgba(30, 16, 10, 0.72)" },
  { fur: "rgba(234, 235, 239, 0.96)", haloLeft: "#ff9d3d", haloRight: "#a78bfa", line: "rgba(16, 16, 20, 0.74)" },
  { fur: "rgba(251, 251, 246, 0.96)", haloLeft: "#facc15", haloRight: "#22c55e", line: "rgba(20, 20, 14, 0.72)" },
  { fur: "rgba(242, 232, 255, 0.96)", haloLeft: "#f97316", haloRight: "#34d399", line: "rgba(23, 14, 30, 0.72)" },
] as const;

const hashSessionId = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return hash;
};

const getMascotVariant = (sessionId: string | null | undefined) => hashSessionId(sessionId || "agent-halo") % MASCOT_THEMES.length;

const getMascotStyle = (variant: number) => {
  const theme = MASCOT_THEMES[variant] ?? MASCOT_THEMES[0];
  return {
    "--mascot-fur": theme.fur,
    "--mascot-halo-left": theme.haloLeft,
    "--mascot-halo-right": theme.haloRight,
    "--mascot-line": theme.line,
  } as CSSProperties & Record<"--mascot-fur" | "--mascot-halo-left" | "--mascot-halo-right" | "--mascot-line", string>;
};

const StatusGlyph = ({ status }: { status: ISessionSummary["status"] }) => {
  if (status === "working") return <span className="status-slot"><span className="glyph-pulse">✱</span></span>;
  if (status === "waiting") return <span className="status-slot"><span className="glyph-waiting">!</span></span>;
  if (status === "done") return <span className="status-slot"><span className="glyph-check">✓</span></span>;
  return <span className="status-slot"><span className={`status-dot status-${status}`} /></span>;
};

type SessionMascotAction = "idle" | "walk" | "plan" | "work" | "coffee" | "hurt" | "dust";

const getSessionMascotAction = (status?: ISessionSummary["status"], activityKind?: ActivityKind): SessionMascotAction => {
  if (activityKind === "error" || status === "error") {
    return "hurt";
  }

  if (activityKind === "planning" || activityKind === "memory" || activityKind === "goal" || activityKind === "asking") {
    if (activityKind === "planning") return "plan";
    return "coffee";
  }

  if (activityKind === "thinking" || activityKind === "visual") {
    return "idle";
  }

  if (status === "working") {
    return "work";
  }

  if (status === "waiting") {
    return "coffee";
  }

  return "idle";
};

const ActivityMascot = ({ activityKind, sessionId, status }: { activityKind?: ActivityKind; sessionId?: string | null; status?: ISessionSummary["status"] }) => {
  const variant = getMascotVariant(sessionId);
  const action = getSessionMascotAction(status, activityKind);

  return (
    <span className="activity-mascot activity-mascot-sprite" data-status={status} data-kind={activityKind} data-action={action} data-variant={variant} style={getMascotStyle(variant)} aria-hidden="true">
      <span className="activity-mascot-stage" />
    </span>
  );
};

const SessionMascot = ({ activityKind, sessionId, status }: { activityKind?: ActivityKind; sessionId?: string | null; status?: ISessionSummary["status"] }) => {
  const variant = getMascotVariant(sessionId);
  const action = getSessionMascotAction(status, activityKind);

  return (
    <span className="session-mascot session-mascot-sprite" data-status={status} data-kind={activityKind} data-action={action} data-variant={variant} style={getMascotStyle(variant)} aria-hidden="true">
      <span className="session-mascot-stage" />
    </span>
  );
};

const createDemoEvent = (index: number): AgentHaloEvent => {
  const timestamp = new Date().toISOString();
  const demoSession = Math.floor(index / 5) % 3;
  const base = {
    version: 1 as const,
    id: `demo-${index}-${crypto.randomUUID()}`,
    timestamp,
    agentId: "agent-demo-mahiro-code",
    agentName: "Mahiro Code",
    conversationId: `local-conv-demo-${demoSession + 1}`,
    cwd: "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
    model: "gpt-5.5",
    permissionMode: "unrestricted",
  };

  switch (index % 5) {
    case 0:
      return { ...base, type: "conversation_open", data: { reason: "startup", previousConversationId: null } };
    case 1:
      return { ...base, type: "turn_start", data: { inputCount: 1 } };
    case 2:
      return { ...base, type: "tool_start", data: { toolCallId: "demo-tool", toolName: "exec_command", argKeys: ["cmd"] } };
    case 3:
      return { ...base, type: "tool_start", data: { toolCallId: "demo-tool-2", toolName: "Agent", argKeys: ["prompt", "description"] } };
    default:
      return { ...base, type: "turn_stop", data: { hookEventName: "Stop", source: "hook", message: "ทำงานเสร็จแล้วค่ะ" } };
  }
};

const buildSessionSummaries = (events: AgentHaloEvent[], presence: IAgentHaloPresence, now: Date): ISessionSummary[] => {
  const groupedEvents = new Map<string, AgentHaloEvent[]>();

  for (const event of events) {
    if (!event.conversationId) continue;
    const sessionEvents = groupedEvents.get(event.conversationId) ?? [];
    sessionEvents.push(event);
    groupedEvents.set(event.conversationId, sessionEvents);
  }

  const sessions = new Map<string, ISessionSummary>();

  for (const [conversationId, sessionEvents] of groupedEvents) {
    if (conversationId === "default" && isInternalOnlySession(sessionEvents)) continue;
    const latestEvent = sessionEvents[0];
    if (!latestEvent) continue;
    const activity = getEventActivity(latestEvent);
    const workspacePath = getSessionWorkspacePath(sessionEvents, latestEvent.cwd);
    sessions.set(conversationId, {
      conversationId,
      project: projectName(workspacePath ?? latestEvent.cwd),
      workspace: shortenPath(workspacePath ?? latestEvent.cwd),
      workspacePath,
      detail: activity.detail,
      activityKind: activity.kind,
      status: getEventSessionStatus(latestEvent, now),
      lastActivityAt: latestEvent.timestamp,
    });
  }

  if (presence.conversationId && !sessions.has(presence.conversationId)) {
    const sessionEvents = groupedEvents.get(presence.conversationId) ?? [];
    const currentEvent = sessionEvents[0]
      ? ({ ...sessionEvents[0], cwd: presence.cwd } satisfies AgentHaloEvent)
      : null;
    const workspacePath = getSessionWorkspacePath(currentEvent ? [currentEvent, ...sessionEvents] : sessionEvents, presence.cwd);
    sessions.set(presence.conversationId, {
      conversationId: presence.conversationId,
      project: projectName(workspacePath ?? presence.cwd),
      workspace: shortenPath(workspacePath ?? presence.cwd),
      workspacePath,
      detail: "idle",
      activityKind: "session",
      status: "idle",
      lastActivityAt: presence.lastEventAt ?? new Date(0).toISOString(),
    });
  }

  return [...sessions.values()];
};



const buildSessionDetail = (
  conversationId: string | null,
  sessions: ISessionSummary[],
  events: AgentHaloEvent[],
  presence: IAgentHaloPresence,
): ISessionDetail | null => {
  if (!conversationId) return null;

  const summary = sessions.find((session) => session.conversationId === conversationId);
  if (!summary) return null;

  const sessionEvents = events.filter((event) => event.conversationId === conversationId);
  const latestEvent = sessionEvents[0];
  const isCurrent = presence.conversationId === conversationId;
  const workspacePath = summary.workspacePath ?? getSessionWorkspacePath(sessionEvents, latestEvent?.cwd);

  return {
    ...summary,
    agentName: (isCurrent ? presence.agentName : latestEvent?.agentName) ?? "Mahiro Code",
    cwd: workspacePath ?? (isCurrent ? presence.cwd : latestEvent?.cwd) ?? "No workspace",
    model: (isCurrent ? presence.model : latestEvent?.model) ?? "Letta Code",
    permissionMode: (isCurrent ? presence.permissionMode : latestEvent?.permissionMode) ?? "—",
    detail: summary.detail,
    events: sessionEvents,
  };
};

const applyEvent = (presence: IAgentHaloPresence, event: AgentHaloEvent) => reducePresence(presence, event);

const appendRecentEvent = (events: AgentHaloEvent[], event: AgentHaloEvent): AgentHaloEvent[] =>
  [event, ...events].slice(0, MAX_RECENT_EVENTS);

const createDemoMetric = (label: string, value: number, remainingLabel: string, resetLabel: string | null, statusLevel: IUsageMetric["statusLevel"] = "ok"): IUsageMetric => {
  const groupLabel = normalizeUsageGroupLabel(label);
  return {
    label,
    groupLabel,
    groupModels: modelsForUsageGroup(groupLabel),
    limitLabel: groupLabel ? "Weekly Limit" : null,
    value,
    statusLevel,
    remainingLabel,
    resetLabel,
  };
};

const demoUsageForProvider = (provider: IUsageProviderConfig): IAgentUsageState =>
  createAgentUsageState(provider.id, {
    status: "online",
    fetchedAt: new Date().toISOString(),
    plan: provider.id === "codex" ? "Pro" : "Max",
    metrics: provider.id === "codex"
      ? [
          createDemoMetric("Session", 73, "73% left", "Resets in 2h 18m"),
          createDemoMetric("Weekly", 91, "91% left", "Resets in 4d 7h"),
          createDemoMetric("Reviews", 96, "96% left", null),
        ]
      : [
          createDemoMetric("Gemini models", 82, "82% left", "Resets in 4h 31m"),
          createDemoMetric("Claude and GPT models", 42, "42% left", "Resets in 1d 19h", "warning"),
        ],
    sessionPercent: provider.id === "codex" ? 27 : null,
    weeklyPercent: provider.id === "codex" ? 9 : null,
    reviewsPercent: provider.id === "codex" ? 4 : null,
    rateLimitResets: provider.id === "codex" ? "1 available" : null,
    credits: provider.id === "codex" ? "$0.00 · 0 credits" : null,
    today: null,
    last30Days: null,
  });

const useAgentUsageList = (settings: IUsageSettings) => {
  const settingsRef = useRef(settings);
  const [usages, setUsages] = useState<Record<UsageProviderId, IAgentUsageState>>(() =>
    Object.fromEntries(USAGE_PROVIDERS.map((provider) => [provider.id, createAgentUsageState(provider.id)])) as Record<UsageProviderId, IAgentUsageState>,
  );
  const [snapshots, setSnapshots] = useState<Partial<Record<UsageProviderId, IAgentUsageSnapshot>>>({});
  const [relativeResetTick, setRelativeResetTick] = useState(0);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const refreshProvider = async (provider: IUsageProviderConfig) => {
    if (DEMO_MODE) {
      setUsages((current) => ({ ...current, [provider.id]: demoUsageForProvider(provider) }));
      return;
    }

    if (typeof window.__TAURI_INTERNALS__ === "undefined") {
      setSnapshots((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setUsages((current) => ({
        ...current,
        [provider.id]: createAgentUsageState(provider.id, { status: "offline", message: "Agent Halo desktop runtime needed" }),
      }));
      return;
    }

    try {
      const snapshot = await invoke<IAgentUsageSnapshot>(provider.command);
      setSnapshots((current) => ({ ...current, [provider.id]: snapshot }));
      setUsages((current) => ({ ...current, [provider.id]: parseAgentUsageSnapshot(provider.id, snapshot, settingsRef.current) }));
    } catch (error) {
      setSnapshots((current) => {
        const next = { ...current };
        delete next[provider.id];
        return next;
      });
      setUsages((current) => ({
        ...current,
        [provider.id]: createAgentUsageState(provider.id, {
          status: "offline",
          message: error instanceof Error ? error.message : String(error || `${provider.label} usage unavailable`),
        }),
      }));
    }
  };

  const refresh = () => {
    for (const provider of USAGE_PROVIDERS) void refreshProvider(provider);
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, settings.refreshMs);
    return () => window.clearInterval(timer);
  }, [settings.refreshMs]);

  useEffect(() => {
    if (settings.resetMode !== "relative") return undefined;
    const timer = window.setInterval(() => setRelativeResetTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, [settings.resetMode]);

  useEffect(() => {
    if (Object.keys(snapshots).length === 0) return;
    setUsages((current) => {
      const next = { ...current };
      for (const provider of USAGE_PROVIDERS) {
        const snapshot = snapshots[provider.id];
        if (!snapshot) continue;
        next[provider.id] = parseAgentUsageSnapshot(provider.id, snapshot, settings);
      }
      return next;
    });
  }, [relativeResetTick, settings.resetMode, settings.timeFormat, settings.usageMode, snapshots]);

  return { refresh, usages };
};

const UsageMeter = ({ metric }: { metric: IUsageMetric }) => (
  <div className="usage-meter" data-empty={metric.value === null}>
    <div className="usage-meter-head">
      <span className="usage-meter-label">{metric.limitLabel ?? metric.label}</span>
      <span className="usage-status-dot" data-level={metric.statusLevel} />
    </div>
    <span className="usage-meter-track" aria-hidden="true">
      <span className="usage-meter-fill" style={{ width: `${metric.value ?? 0}%` }} />
    </span>
    <div className="usage-meter-foot">
      <span>{metric.remainingLabel ?? "—"}</span>
      {metric.resetLabel ? <span>{metric.resetLabel}</span> : null}
    </div>
  </div>
);

const getAntigravityMetricGroups = (metrics: IUsageMetric[]): IUsageMetricGroup[] => {
  const grouped = ANTIGRAVITY_USAGE_GROUPS.map((group) => ({ ...group, metrics: [] as IUsageMetric[] }));
  for (const metric of metrics) {
    const group = grouped.find((item) => item.label === metric.groupLabel);
    if (group) group.metrics.push(metric);
  }
  return grouped;
};

const UsageMetricGroupCard = ({ group }: { group: IUsageMetricGroup }) => (
  <section className="usage-metric-group">
    <div className="usage-group-title">{group.label}</div>
    <div className="usage-group-models">Models within this group: {group.models.join(", ")}</div>
    {group.metrics.length > 0 ? (
      <div className="usage-group-meters">
        {group.metrics.map((metric) => <UsageMeter metric={metric} key={`${group.label}-${metric.limitLabel ?? metric.label}`} />)}
      </div>
    ) : (
      <div className="usage-group-empty">No quota data from current source</div>
    )}
  </section>
);

const AntigravityUsageGroups = ({ metrics }: { metrics: IUsageMetric[] }) => (
  <div className="usage-group-list">
    {getAntigravityMetricGroups(metrics).map((group) => <UsageMetricGroupCard group={group} key={group.label} />)}
  </div>
);

const UsageProviderLinks = ({ links }: { links: IUsageProviderConfig["links"] }) => {
  if (!links || links.length === 0) return null;
  const openLink = (url: string) => {
    if (typeof window.__TAURI_INTERNALS__ === "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    void invoke("open_external_url", { url }).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer");
    });
  };
  return (
    <div className="usage-provider-links">
      {links.map((link) => (
        <button className="usage-provider-link" type="button" onClick={(event) => { event.stopPropagation(); openLink(link.url); }} data-tauri-drag-region="false" key={link.url}>
          <span>{link.label}</span>
          <ExternalLink size={10} strokeWidth={2.4} />
        </button>
      ))}
    </div>
  );
};

const UsageTextRows = ({ rows }: { rows: Array<{ label: string; value: string | null }> }) => {
  const visibleRows = rows.filter((row) => row.value);
  if (visibleRows.length === 0) return null;
  return (
    <div className="usage-text-rows">
      {visibleRows.map((row) => (
        <div className="usage-text-row" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
};

const UsageTrendChart = ({ line }: { line: IUsageMetricLine | null }) => {
  const points = line?.points?.filter((point) => Number.isFinite(point.value) && point.value >= 0) ?? [];
  if (points.length === 0) return null;
  const max = Math.max(...points.map((point) => point.value), 1);
  return (
    <div className="usage-trend-card">
      <div className="usage-trend-head">
        <span>{line?.label ?? "Usage Trend"}</span>
        {line?.note ? <small title={line.note}>ⓘ</small> : null}
      </div>
      <div className="usage-trend-bars" aria-label="Codex usage trend">
        {points.map((point, index) => (
          <span
            className="usage-trend-bar"
            style={{ height: `${Math.max(8, (point.value / max) * 100)}%`, backgroundColor: line?.color ?? undefined }}
            title={`${point.label}: ${point.valueLabel ?? point.value}`}
            key={`${point.label}-${index}`}
          />
        ))}
      </div>
    </div>
  );
};

const ModelShareRows = ({ rows }: { rows: Array<{ label: string; value: string }> }) => {
  if (rows.length === 0) return null;
  return (
    <div className="usage-model-shares">
      {rows.map((row) => (
        <div className="usage-model-share" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
};

const DailyTokenRows = ({ rows }: { rows: Array<{ label: string; value: string }> }) => {
  if (rows.length === 0) return null;
  return (
    <div className="usage-daily-tokens">
      <div className="usage-daily-title">Daily Tokens</div>
      {rows.map((row) => (
        <div className="usage-daily-token" key={row.label}>
          <span>{row.label}</span>
          <strong>{row.value}</strong>
        </div>
      ))}
    </div>
  );
};

const CodexUsageDetails = ({ usage }: { usage: IAgentUsageState }) => (
  <>
    <UsageTextRows
      rows={[
        { label: "Credits", value: usage.credits },
        { label: "Rate Limit Resets", value: usage.rateLimitResets },
        { label: "Today", value: usage.today },
        { label: "Yesterday", value: usage.yesterday },
        { label: "Latest Token Log", value: usage.latestTokenLog },
        { label: "Last 30 Days", value: usage.last30Days },
      ]}
    />
    <UsageTrendChart line={usage.usageTrend} />
    <DailyTokenRows rows={usage.dailyTokenRows} />
    <ModelShareRows rows={usage.modelShares} />
  </>
);

const UsageProviderIcon = ({ provider, size = 14 }: { provider: IUsageProviderConfig; size?: number }) => (
  <span
    className="usage-provider-icon"
    aria-hidden="true"
    style={{
      "--provider-icon": `url(${provider.iconPath})`,
      "--provider-color": provider.color,
      width: size,
      height: size,
    } as CSSProperties & Record<"--provider-icon" | "--provider-color", string>}
  />
);

const UsageProviderDetail = ({ provider, usage }: { provider: IUsageProviderConfig; usage: IAgentUsageState }) => {
  const statusText = usage.status === "loading" ? `Checking ${provider.label}` : usage.message ?? `${provider.label} usage unavailable`;
  const StatusIcon = usage.status === "loading" ? RefreshCw : TriangleAlert;

  return (
    <section className="usage-provider-card" data-status={usage.status}>
      <div className="usage-provider-head">
        <span className="usage-provider-title"><UsageProviderIcon provider={provider} />{provider.label}</span>
        {usage.plan ? <span className="usage-plan">{usage.plan}</span> : null}
      </div>
      <UsageProviderLinks links={provider.links} />
      {usage.status === "online" && usage.metrics.length > 0 ? (
        <div className="usage-provider-metrics">
          {provider.id === "agy" ? <AntigravityUsageGroups metrics={usage.metrics} /> : usage.metrics.map((metric) => <UsageMeter metric={metric} key={metric.label} />)}
        </div>
      ) : (
        <div className="usage-provider-message">
          <StatusIcon size={13} strokeWidth={2.2} />
          <span>{statusText}</span>
        </div>
      )}
      {provider.id === "codex" && usage.status === "online" ? <CodexUsageDetails usage={usage} /> : null}
      {(usage.credits || usage.rateLimitResets) ? (
        <div className="usage-provider-chips" data-hidden={provider.id === "codex"}>
          {usage.credits ? <span className="usage-chip" title="Credits">{usage.credits}</span> : null}
          {usage.rateLimitResets ? <span className="usage-chip" title="Rate limit resets">{usage.rateLimitResets}</span> : null}
        </div>
      ) : null}
    </section>
  );
};

const SettingSegment = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ label: string; value: T; sublabel?: string }>;
  value: T;
  onChange: (value: T) => void;
}) => (
  <div className="usage-setting-segment">
    {options.map((option) => (
      <button
        className="usage-setting-option"
        data-active={option.value === value}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onChange(option.value);
        }}
        data-tauri-drag-region="false"
        key={option.value}
      >
        <span>{option.label}</span>
        {option.sublabel ? <small>{option.sublabel}</small> : null}
      </button>
    ))}
  </div>
);

const UsageSettingsPanel = ({ settings, onChange }: { settings: IUsageSettings; onChange: (settings: IUsageSettings) => void }) => {
  const sampleReset = new Date(Date.now() + 5 * 60 * 60 * 1000 + 12 * 60_000).toISOString();
  const set = (partial: Partial<IUsageSettings>) => onChange({ ...settings, ...partial });

  return (
    <section className="usage-settings-panel">
      <div className="usage-provider-head">
        <span className="usage-provider-title"><Settings size={14} strokeWidth={2.2} />Usage settings</span>
      </div>
      <div className="usage-setting-group">
        <span className="usage-setting-title">Auto refresh</span>
        <span className="usage-setting-desc">How often provider usage is refreshed</span>
        <SettingSegment
          value={`${settings.refreshMs}`}
          onChange={(value) => set({ refreshMs: Number(value) })}
          options={[
            { label: "5 min", value: `${5 * 60_000}` },
            { label: "15 min", value: `${15 * 60_000}` },
            { label: "30 min", value: `${30 * 60_000}` },
            { label: "1 hour", value: `${60 * 60_000}` },
          ]}
        />
      </div>
      <div className="usage-setting-group">
        <span className="usage-setting-title">Usage mode</span>
        <span className="usage-setting-desc">Whether bars show remaining or consumed quota</span>
        <SettingSegment
          value={settings.usageMode}
          onChange={(value) => set({ usageMode: value })}
          options={[{ label: "Left", value: "left" }, { label: "Used", value: "used" }]}
        />
      </div>
      <div className="usage-setting-group">
        <span className="usage-setting-title">Reset timers</span>
        <span className="usage-setting-desc">Countdown or clock time</span>
        <SettingSegment
          value={settings.resetMode}
          onChange={(value) => set({ resetMode: value })}
          options={[
            { label: "Relative", value: "relative", sublabel: formatResetLabel(sampleReset, { ...settings, resetMode: "relative" })?.replace("Resets in ", "") },
            { label: "Absolute", value: "absolute", sublabel: formatResetLabel(sampleReset, { ...settings, resetMode: "absolute" })?.replace("Reset at ", "") },
          ]}
        />
      </div>
      <div className="usage-setting-group">
        <span className="usage-setting-title">Time format</span>
        <span className="usage-setting-desc">Used by absolute reset times</span>
        <SettingSegment
          value={settings.timeFormat}
          onChange={(value) => set({ timeFormat: value })}
          options={[
            { label: "Auto", value: "auto", sublabel: formatAbsoluteTime(sampleReset, "auto") ?? undefined },
            { label: "12-hour", value: "12h", sublabel: formatAbsoluteTime(sampleReset, "12h") ?? undefined },
            { label: "24-hour", value: "24h", sublabel: formatAbsoluteTime(sampleReset, "24h") ?? undefined },
          ]}
        />
      </div>
    </section>
  );
};

const AgentUsageList = ({ onRefresh, onSettingsChange, settings, usages }: {
  onRefresh: () => void;
  onSettingsChange: (settings: IUsageSettings) => void;
  settings: IUsageSettings;
  usages: Record<UsageProviderId, IAgentUsageState>;
}) => {
  const [selectedProviderId, setSelectedProviderId] = useState<UsageSidebarSelection | null>(null);
  const visibleProviders = useMemo(
    () => USAGE_PROVIDERS.filter((provider) => {
      const usage = usages[provider.id] ?? createAgentUsageState(provider.id);
      return usage.status === "loading" || usage.status === "online";
    }),
    [usages],
  );
  const selectedProvider = selectedProviderId === "settings" ? null : visibleProviders.find((provider) => provider.id === selectedProviderId) ?? visibleProviders[0] ?? null;
  const activeSidebarId: UsageSidebarSelection = selectedProviderId === "settings" ? "settings" : selectedProvider?.id ?? "settings";

  useEffect(() => {
    if (visibleProviders.length === 0) {
      setSelectedProviderId("settings");
      return;
    }
    if (selectedProviderId === "settings") return;
    if (!selectedProviderId || !visibleProviders.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(visibleProviders[0].id);
    }
  }, [selectedProviderId, visibleProviders]);

  return (
    <div className="usage-list" aria-label="Usage providers">
      <div className="usage-list-topline">
        <span>Usage</span>
        <button className="usage-refresh" type="button" onClick={(event) => { event.stopPropagation(); onRefresh(); }} data-tauri-drag-region="false" title="Refresh usage">
          <RefreshCw size={12} strokeWidth={2.2} />
        </button>
      </div>
      <div className="usage-layout">
          <div className="usage-sidebar" role="tablist" aria-label="Usage providers">
            {visibleProviders.map((provider) => {
              const usage = usages[provider.id] ?? createAgentUsageState(provider.id);
              return (
                <button
                  className="usage-side-tab"
                  data-active={activeSidebarId === provider.id}
                  type="button"
                  role="tab"
                  aria-selected={activeSidebarId === provider.id}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedProviderId(provider.id);
                  }}
                  data-tauri-drag-region="false"
                  key={provider.id}
                  title={provider.label}
                >
                  <UsageProviderIcon provider={provider} size={13} />
                  <span>{provider.label}</span>
                  {usage.status === "online" ? <span className="usage-side-dot" /> : null}
                </button>
              );
            })}
            <button
              className="usage-side-tab usage-side-settings"
              data-active={activeSidebarId === "settings"}
              type="button"
              role="tab"
              aria-selected={activeSidebarId === "settings"}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedProviderId("settings");
              }}
              data-tauri-drag-region="false"
              title="Usage settings"
            >
              <Settings size={13} strokeWidth={2.2} />
              <span>Settings</span>
            </button>
          </div>
          <div className="usage-detail-panel">
            {activeSidebarId === "settings" ? (
              <UsageSettingsPanel settings={settings} onChange={onSettingsChange} />
            ) : selectedProvider ? (
              <UsageProviderDetail provider={selectedProvider} usage={usages[selectedProvider.id] ?? createAgentUsageState(selectedProvider.id)} />
            ) : <div className="usage-empty">No local usage providers found</div>}
          </div>
        </div>
    </div>
  );
};

const useAgentHaloPresence = () => {
  const [presence, setPresence] = useState<IAgentHaloPresence>(() => createInitialPresence());
  const [recentEvents, setRecentEvents] = useState<AgentHaloEvent[]>([]);
  const [lastLiveEvent, setLastLiveEvent] = useState<AgentHaloEvent | null>(null);
  const [sessionEventRegistry, setSessionEventRegistry] = useState<SessionEventRegistry>(readSessionEventRegistry);
  const [capabilities, setCapabilities] = useState<IAgentHaloBridgeCapabilities>(() => createDefaultBridgeCapabilities());
  const [connection, setConnection] = useState<IConnectionState>({ status: "connecting", message: null });
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;

    if (DEMO_MODE) {
      setConnection({ status: "connected", message: "Demo mode" });
      setCapabilities({
        ...createDefaultBridgeCapabilities(),
        events: { lifecycle: true, turns: true, tools: true },
      });
      let index = 0;
      const pushDemoEvent = () => {
        const event = createDemoEvent(index);
        index += 1;
        setLastLiveEvent(event);
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
        setSessionEventRegistry((current) => {
          const next = mergeSessionEvents(current, [event]);
          writeSessionEventRegistry(next);
          return next;
        });
      };
      pushDemoEvent();
      const timer = window.setInterval(pushDemoEvent, 1_600);
      return () => window.clearInterval(timer);
    }

    const hydrate = async () => {
      try {
        const response = await fetch(`${BRIDGE_URL}/snapshot`);
        if (!response.ok) throw new Error(`Snapshot HTTP ${response.status}`);
        const payload = (await response.json()) as { recent?: AgentHaloEvent[]; capabilities?: IAgentHaloBridgeCapabilities };
        if (!disposed) {
          if (payload.capabilities) setCapabilities(payload.capabilities);
          if (Array.isArray(payload.recent)) {
            setPresence(payload.recent.reduce(applyEvent, createInitialPresence()));
            setRecentEvents(payload.recent.slice(-MAX_RECENT_EVENTS).reverse());
            setSessionEventRegistry((current) => {
              const next = mergeSessionEvents(current, payload.recent ?? []);
              writeSessionEventRegistry(next);
              return next;
            });
          }
        }
      } catch {
        // Live SSE is the source of truth; snapshot only improves first paint.
      }
    };

    const hydrateHealth = async () => {
      try {
        const response = await fetch(`${BRIDGE_URL}/health`);
        if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
        const payload = (await response.json()) as { capabilities?: IAgentHaloBridgeCapabilities };
        if (!disposed && payload.capabilities) setCapabilities(payload.capabilities);
      } catch {
        // SSE connection state covers bridge availability.
      }
    };

    void hydrate();
    void hydrateHealth();

    source = new EventSource(`${BRIDGE_URL}/events`);
    source.onopen = () => {
      if (!disposed) setConnection({ status: "connected", message: null });
    };
    source.onerror = () => {
      if (!disposed) {
        setConnection({
          status: source?.readyState === EventSource.CLOSED ? "disconnected" : "error",
          message: "Waiting for Agent Halo bridge",
        });
      }
    };

    const handleEvent = (message: MessageEvent<string>) => {
      try {
        const event = JSON.parse(message.data) as AgentHaloEvent;
        setLastLiveEvent(event);
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
        setSessionEventRegistry((current) => {
          const next = mergeSessionEvents(current, [event]);
          writeSessionEventRegistry(next);
          return next;
        });
      } catch {
        setConnection({ status: "error", message: "Received malformed bridge event" });
      }
    };

    for (const type of ["bridge_ready", "conversation_open", "conversation_close", "turn_start", "turn_stop", "tool_start", "bridge_error"]) {
      source.addEventListener(type, handleEvent as EventListener);
    }

    return () => {
      disposed = true;
      source?.close();
    };
  }, []);

  const refreshCapabilities = async (): Promise<boolean> => {
    try {
      const response = await fetch(`${BRIDGE_URL}/health`);
      if (!response.ok) throw new Error(`Health HTTP ${response.status}`);
      const payload = (await response.json()) as { capabilities?: IAgentHaloBridgeCapabilities };
      if (payload.capabilities) setCapabilities(payload.capabilities);
      return true;
    } catch {
      return false;
    }
  };

  const view = useMemo(() => getPresenceView(presence, { now, staleAfterMs: STALE_AFTER_MS }), [now, presence]);
  const sessionEvents = useMemo(() => flattenSessionEvents(sessionEventRegistry), [sessionEventRegistry]);
  return { capabilities, connection, lastLiveEvent, now, presence, recentEvents, refreshCapabilities, sessionEvents, setSessionEventRegistry, view };
};

const App = () => {
  const { capabilities, connection, lastLiveEvent, now, presence, recentEvents, refreshCapabilities, sessionEvents, setSessionEventRegistry, view } = useAgentHaloPresence();
  const [usageSettings, setUsageSettings] = useState<IUsageSettings>(readUsageSettings);
  const { refresh: refreshAgentUsage, usages: agentUsages } = useAgentUsageList(usageSettings);
  const [acknowledgedConversationId, setAcknowledgedConversationId] = useState<string | null>(null);
  const [nativeAction, setNativeAction] = useState<INativeActionState>({ bridgeOnline: null, message: null });
  const [sessionAction, setSessionAction] = useState<ISessionActionState>({ ok: null, message: null });
  const [panelOpen, setPanelOpen] = useState(DEMO_MODE);
  const [renderPanel, setRenderPanel] = useState(DEMO_MODE);
  const [panelHeight, setPanelHeight] = useState(PANEL_MIN_HEIGHT);
  const [hoverExpandSuppressed, setHoverExpandSuppressed] = useState(false);
  const [activeMainTab, setActiveMainTab] = useState<MainPanelTab>("sessions");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [modStatus, setModStatus] = useState<IModStatus>({ path: null, installed: null });
  const [notchMetrics, setNotchMetrics] = useState<INotchMetrics>({ cameraWidth: DEFAULT_CAMERA_NOTCH_WIDTH, closedHeight: DEFAULT_CLOSED_NOTCH_HEIGHT });
  const [nativeClosedSurfaceWidth, setNativeClosedSurfaceWidth] = useState(DEFAULT_CAMERA_NOTCH_WIDTH);
  const [dismissedSessionIds, setDismissedSessionIds] = useState<DismissedSessionRegistry>(readDismissedSessionIds);
  const [deletedSessionIds, setDeletedSessionIds] = useState<DeletedSessionRegistry>(readDeletedSessionIds);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const sheetInnerRef = useRef<HTMLDivElement | null>(null);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const displayView =
    isDeletedAfter(deletedSessionIds, presence.conversationId, presence.lastEventAt) ||
    (view.status === "closed" && (acknowledgedConversationId === presence.conversationId || isDismissedAfter(dismissedSessionIds, presence.conversationId, presence.lastEventAt)))
      ? ({ ...view, status: "idle", label: "idle" } satisfies IStatusView)
      : view;
  const canUseNativeControls = typeof window.__TAURI_INTERNALS__ !== "undefined";
  const isConnected = connection.status === "connected";
  const connectionTitle = DEMO_MODE ? "Demo mode" : (connection.message ?? connection.status);
  const workspace = shortenPath(presence.cwd);
  const project = projectName(presence.cwd);
  const model = presence.model?.split("/").slice(-1)[0] ?? "Letta Code";
  const sessions = useMemo(
    () =>
      buildSessionSummaries(sessionEvents, presence, now).filter(
        (session) =>
          !isDeletedAfter(deletedSessionIds, session.conversationId, session.lastActivityAt) &&
          (!isDismissedAfter(dismissedSessionIds, session.conversationId, session.lastActivityAt) ||
            (session.conversationId === presence.conversationId && !["idle", "closed"].includes(displayView.status))),
      ),
    [deletedSessionIds, dismissedSessionIds, displayView.status, now, presence, sessionEvents],
  );
  const selectedSession = useMemo(
    () => buildSessionDetail(selectedSessionId, sessions, sessionEvents, presence),
    [presence, selectedSessionId, sessionEvents, sessions],
  );
  const selectedSessionActivityEvents = useMemo(() => {
    if (!selectedSession) return [];
    const fallbackEvents = recentEvents.filter((event) => event.conversationId === selectedSession.conversationId);
    return getUniqueSortedEvents([...selectedSession.events, ...fallbackEvents]).slice(0, 16);
  }, [recentEvents, selectedSession]);
  const sessionGroups = useMemo(() => buildWorkspaceSessionGroups(sessions), [sessions]);

  useEffect(() => {
    if (!presence.conversationId) return;
    if (acknowledgedConversationId !== presence.conversationId) return;
    if (view.status !== "thinking" && view.status !== "tool-running" && view.status !== "stale") return;
    setAcknowledgedConversationId(null);
  }, [acknowledgedConversationId, presence.conversationId, view.status]);

  useEffect(() => {
    if (!lastLiveEvent?.conversationId) return;
    if (!["turn_start", "tool_start", "turn_stop"].includes(lastLiveEvent.type)) return;

    setDismissedSessionIds((current) => {
      const conversationId = lastLiveEvent.conversationId ?? "";
      if (typeof current[conversationId] !== "number" || isDismissedAfter(current, conversationId, lastLiveEvent.timestamp)) return current;
      const { [conversationId]: _removed, ...next } = current;
      writeDismissedSessionIds(next);
      return next;
    });

    setDeletedSessionIds((current) => {
      const conversationId = lastLiveEvent.conversationId ?? "";
      if (typeof current[conversationId] !== "number" || isDeletedAfter(current, conversationId, lastLiveEvent.timestamp)) return current;
      const { [conversationId]: _removed, ...next } = current;
      writeDeletedSessionIds(next);
      return next;
    });
  }, [lastLiveEvent]);
  const headerLabel = setupOpen
    ? "Setup"
    : selectedSession
      ? selectedSession.project
      : activeMainTab === "usage"
        ? "Usage"
        : sessionGroups.length === 0
          ? "Agent Halo"
          : sessionGroups.length === 1
            ? sessionGroups[0].sessions.length === 1 ? "1 session" : `${sessionGroups[0].sessions.length} sessions`
            : `${sessionGroups.length} workspaces`;
  const activitySession =
    sessions.find((session) => session.status === "working") ??
    sessions.find((session) => session.status === "waiting") ??
    sessions.find((session) => session.status === "done" && session.conversationId !== acknowledgedConversationId) ??
    null;
  const activityStatus = activitySession?.status ?? getGlyphStatus(displayView.status);
  const activityKind: ActivityKind = activitySession?.activityKind ?? (displayView.status === "thinking" ? "thinking" : displayView.status === "stale" ? "tool" : displayView.status === "error" ? "error" : displayView.status === "closed" ? "done" : "session");
  const activityViewStatus: IStatusView["status"] = (() => {
    if (activityStatus === "working") return "tool-running";
    if (activityStatus === "waiting") return "stale";
    if (activityStatus === "done") return "closed";
    if (activityStatus === "error") return "error";
    return displayView.status;
  })();
  const glyphStatus = getGlyphStatus(activityViewStatus);
  const isWorkingActivity = activityStatus === "working" || activityStatus === "waiting";
  const hasLiveActivity = isWorkingActivity || activityStatus === "done" || activityStatus === "error";
  const pillDetail = (() => {
    if (activitySession?.status === "working") return activitySession.detail === "thinking" ? "Thinking" : activitySession.detail;
    if (activitySession?.status === "waiting") return "Still?";
    if (activitySession?.status === "done") return "Done";
    if (activityStatus === "error") return "Error";
    return project;
  })();
  const liveActivityWingWidth = hasLiveActivity ? estimateLiveActivityWingWidth(pillDetail) : 0;
  const closedSurfaceWidth = Math.round(notchMetrics.cameraWidth + liveActivityWingWidth * 2);
  const closedSurfaceHeight = Math.round(notchMetrics.closedHeight);
  const notchStyle = {
    "--closed-width": `${closedSurfaceWidth}px`,
    "--closed-height": `${closedSurfaceHeight}px`,
    "--camera-width": `${Math.round(notchMetrics.cameraWidth)}px`,
    "--panel-height": `${panelHeight}px`,
    "--pill-text-width": `${Math.max(0, liveActivityWingWidth - LIVE_ACTIVITY_TEXT_WIDTH_BUFFER)}px`,
  } as CSSProperties & Record<"--closed-width" | "--closed-height" | "--camera-width" | "--panel-height" | "--pill-text-width", string>;
  const shouldAutoOpen = activityStatus === "error";
  const surfaceState = renderPanel ? (panelOpen ? "open" : "closing") : "closed";
  const shapeMetrics = surfaceState === "open"
    ? { width: PANEL_WINDOW_WIDTH, height: panelHeight, topRadius: OPEN_TOP_SHOULDER_RADIUS, bottomRadius: PANEL_BOTTOM_RADIUS }
    : { width: closedSurfaceWidth, height: closedSurfaceHeight, topRadius: CLOSED_TOP_SHOULDER_RADIUS, bottomRadius: CLOSED_BOTTOM_RADIUS };
  const notchShapePath = buildNotchShapePath(shapeMetrics.width, shapeMetrics.height, shapeMetrics.topRadius, shapeMetrics.bottomRadius);
  const setupGuidance = (() => {
    if (!canUseNativeControls) {
      return {
        title: "Open desktop runtime",
        detail: DEMO_MODE ? "Browser demo cannot install or check the mod" : "Use pnpm desktop:dev for native setup",
      };
    }

    if (modStatus.installed === false) {
      return {
        title: "Install Letta mod",
        detail: "Writes ~/.letta/mods/agent-halo.js locally",
      };
    }

    if (modStatus.installed === true && !isConnected) {
      return {
        title: "Reload Letta Code",
        detail: "Run /reload after install, then Check",
      };
    }

    if (isConnected) {
      return {
        title: "Ready",
        detail: "Bridge streaming lifecycle, turn, and tool events",
      };
    }

    return {
      title: "Checking setup",
      detail: canUseNativeControls ? "Reading local mod and bridge state" : "Waiting for runtime",
    };
  })();

  useEffect(() => {
    let shrinkTimer: number | null = null;

    setNativeClosedSurfaceWidth((currentWidth) => {
      if (closedSurfaceWidth >= currentWidth) return closedSurfaceWidth;
      shrinkTimer = window.setTimeout(() => setNativeClosedSurfaceWidth(closedSurfaceWidth), ACTIVITY_COLLAPSE_MS);
      return currentWidth;
    });

    return () => {
      if (shrinkTimer !== null) window.clearTimeout(shrinkTimer);
    };
  }, [closedSurfaceWidth]);

  useEffect(() => {
    if (shouldAutoOpen) setPanelOpen(true);
  }, [shouldAutoOpen]);

  useEffect(() => {
    if (!canUseNativeControls) return;

    void invoke<[number, number]>("notch_metrics")
      .then(([cameraWidth, closedHeight]) => {
        setNotchMetrics({
          cameraWidth: Number.isFinite(cameraWidth) ? cameraWidth : DEFAULT_CAMERA_NOTCH_WIDTH,
          closedHeight: Number.isFinite(closedHeight) ? closedHeight : DEFAULT_CLOSED_NOTCH_HEIGHT,
        });
      })
      .catch(() => {
        setNotchMetrics({ cameraWidth: DEFAULT_CAMERA_NOTCH_WIDTH, closedHeight: DEFAULT_CLOSED_NOTCH_HEIGHT });
      });
  }, [canUseNativeControls]);

  useEffect(() => {
    if (!renderPanel) {
      setPanelHeight(PANEL_MIN_HEIGHT);
      return;
    }

    if (activeMainTab === "usage" && !setupOpen && !selectedSessionId) {
      setPanelHeight(PANEL_MAX_HEIGHT);
      return;
    }

    const target = sheetInnerRef.current;
    if (!target) return;

    const measureContentHeight = () => Array.from(target.children).reduce((total, child) => {
      const element = child as HTMLElement;
      if (element.classList.contains("sheet-body")) {
        const style = window.getComputedStyle(element);
        const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
        const bodyContent = Array.from(element.children).reduce((bodyTotal, bodyChild) => bodyTotal + Math.ceil((bodyChild as HTMLElement).scrollHeight), 0);
        return total + padding + bodyContent;
      }
      return total + Math.ceil(element.getBoundingClientRect().height);
    }, 0);

    const updateHeight = () => {
      const measured = measureContentHeight();
      setPanelHeight((current) => {
        const next = clampPanelHeight(measured);
        return Math.abs(next - current) < 2 ? current : next;
      });
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(target);
    for (const child of Array.from(target.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [activeMainTab, agentUsages, renderPanel, selectedSessionId, sessionGroups.length, setupOpen]);

  useEffect(() => {
    let cancelled = false;

    const resizeNativePanel = async (open: boolean) => {
      if (!canUseNativeControls) return;
      await invoke("set_panel_open", {
        open,
        width: open ? PANEL_WINDOW_WIDTH : nativeClosedSurfaceWidth,
        height: open ? panelHeight : closedSurfaceHeight,
      });
    };

    if (panelOpen) {
      void (async () => {
        await resizeNativePanel(true);
        await waitForNextPaint();
        await waitForNextPaint();
        if (!cancelled) setRenderPanel(true);
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!renderPanel) {
      void resizeNativePanel(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      setRenderPanel(false);
      void resizeNativePanel(false);
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [canUseNativeControls, closedSurfaceHeight, nativeClosedSurfaceWidth, panelHeight, panelOpen, renderPanel]);

  useEffect(
    () => () => {
      if (hoverOpenTimerRef.current !== null) window.clearTimeout(hoverOpenTimerRef.current);
      if (hoverCloseTimerRef.current !== null) window.clearTimeout(hoverCloseTimerRef.current);
    },
    [],
  );

  const clearHoverOpenTimer = () => {
    if (hoverOpenTimerRef.current === null) return;
    window.clearTimeout(hoverOpenTimerRef.current);
    hoverOpenTimerRef.current = null;
  };

  const clearHoverCloseTimer = () => {
    if (hoverCloseTimerRef.current === null) return;
    window.clearTimeout(hoverCloseTimerRef.current);
    hoverCloseTimerRef.current = null;
  };

  const closePanel = ({ suppressHover }: { suppressHover: boolean }) => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    if (suppressHover) setHoverExpandSuppressed(true);
    setSelectedSessionId(null);
    setSetupOpen(false);
    setPanelOpen(false);
  };

  const expandPanelOnHover = () => {
    clearHoverCloseTimer();
    if (renderPanel || panelOpen || hoverExpandSuppressed) return;
    if (hoverOpenTimerRef.current !== null) return;
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      if (hoverExpandSuppressed) return;
      setPanelOpen(true);
    }, HOVER_OPEN_DELAY_MS);
  };

  const scheduleHoverClose = () => {
    clearHoverOpenTimer();
    setHoverExpandSuppressed(false);
    if (shouldAutoOpen || setupOpen || selectedSessionId || !panelOpen) return;
    if (hoverCloseTimerRef.current !== null) return;
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      closePanel({ suppressHover: false });
    }, HOVER_CLOSE_DELAY_MS);
  };

  useEffect(() => {
    if (!panelOpen || setupOpen || selectedSessionId || shouldAutoOpen) return;

    const isOutsideSurface = (event: MouseEvent) => {
      const surface = surfaceRef.current;
      if (!surface) return false;
      const rect = surface.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (isOutsideSurface(event)) scheduleHoverClose();
    };

    const handleMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget === null) scheduleHoverClose();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);
    };
  }, [panelOpen, selectedSessionId, setupOpen, shouldAutoOpen]);

  const openSession = (conversationId: string) => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    setSetupOpen(false);
    setActiveMainTab("sessions");
    setSessionAction({ ok: null, message: null });
    setSelectedSessionId(conversationId);
    setPanelOpen(true);
  };

  const openSetup = () => {
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    setSelectedSessionId(null);
    setSetupOpen(true);
    setPanelOpen(true);
  };

  const updateUsageSettings = (settings: IUsageSettings) => {
    setUsageSettings(settings);
    writeUsageSettings(settings);
  };

  const backToSessions = () => {
    setSelectedSessionId(null);
    setSetupOpen(false);
    setActiveMainTab("sessions");
  };

  const dismissSession = (conversationId: string) => {
    setDismissedSessionIds((current) => {
      const next = { ...current, [conversationId]: Date.now() };
      writeDismissedSessionIds(next);
      return next;
    });
    if (conversationId === presence.conversationId) setAcknowledgedConversationId(conversationId);
    if (selectedSessionId === conversationId) setSelectedSessionId(null);
  };

  const dismissSessionGroup = (group: IWorkspaceSessionGroup) => {
    const dismissedAt = Date.now();
    setDismissedSessionIds((current) => {
      const next = { ...current };
      for (const session of group.sessions) next[session.conversationId] = dismissedAt;
      writeDismissedSessionIds(next);
      return next;
    });
    setAcknowledgedConversationId(null);
    if (selectedSessionId && group.sessions.some((session) => session.conversationId === selectedSessionId)) setSelectedSessionId(null);
  };

  const deleteSession = (conversationId: string) => {
    setSessionAction({ ok: null, message: null });
    setSessionEventRegistry((current) => {
      const { [conversationId]: _removed, ...next } = current;
      writeSessionEventRegistry(next);
      return next;
    });
    setDismissedSessionIds((current) => {
      if (typeof current[conversationId] !== "number") return current;
      const { [conversationId]: _removed, ...next } = current;
      writeDismissedSessionIds(next);
      return next;
    });
    setDeletedSessionIds((current) => {
      const next = { ...current, [conversationId]: Date.now() };
      writeDeletedSessionIds(next);
      return next;
    });
    if (conversationId === acknowledgedConversationId) setAcknowledgedConversationId(null);
    if (selectedSessionId === conversationId) setSelectedSessionId(null);
  };

  const loadModStatus = async () => {
    if (!canUseNativeControls) {
      setModStatus({ path: null, installed: null });
      return;
    }

    try {
      const [path, installed] = await invoke<[string, boolean]>("agent_halo_mod_status");
      setModStatus({ path, installed });
    } catch {
      setModStatus({ path: null, installed: null });
    }
  };

  const acknowledgeDone = () => {
    const conversationId = activitySession?.status === "done" ? activitySession.conversationId : presence.conversationId;
    setAcknowledgedConversationId(conversationId);
    setSelectedSessionId(null);
    setPanelOpen(false);
  };

  const checkBridge = async () => {
    if (!canUseNativeControls) {
      setNativeAction({ bridgeOnline: null, message: "Native controls need Tauri runtime" });
      return;
    }

    try {
      const online = await invoke<boolean>("bridge_health");
      const refreshed = online ? await refreshCapabilities() : false;
      setNativeAction({ bridgeOnline: online, message: online ? (refreshed ? "Bridge reachable · capabilities synced" : "Bridge reachable") : "Bridge offline" });
    } catch (error) {
      setNativeAction({ bridgeOnline: false, message: error instanceof Error ? error.message : "Native bridge check unavailable" });
    }
  };

  const installMod = async () => {
    if (!canUseNativeControls) {
      setNativeAction({ bridgeOnline: nativeAction.bridgeOnline, message: "Open with pnpm desktop:dev" });
      return;
    }

    try {
      const path = await invoke<string>("install_agent_halo_mod");
      setModStatus({ path, installed: true });
      setNativeAction({ bridgeOnline: nativeAction.bridgeOnline, message: `Installed → ${shortenPath(path)} · reload Letta Code` });
    } catch (error) {
      setNativeAction({
        bridgeOnline: nativeAction.bridgeOnline,
        message: error instanceof Error ? error.message : "Install failed; run pnpm mod:install",
      });
    }
  };

  const focusSelectedSession = async (session: ISessionDetail | ISessionSummary) => {
    if (!canUseNativeControls) {
      setSessionAction({ ok: false, message: "Focus needs the desktop runtime" });
      return;
    }

    try {
      const message = await invoke<string>("focus_terminal", {
        conversationId: session.conversationId,
        cwd: "cwd" in session ? session.cwd : session.workspacePath,
      });
      setSessionAction({ ok: true, message });
      closePanel({ suppressHover: true });
    } catch (error) {
      setSessionAction({ ok: false, message: error instanceof Error ? error.message : "Ghostty focus failed" });
    }
  };

  useEffect(() => {
    if (setupOpen) void loadModStatus();
  }, [setupOpen]);

  return (
    <main className="overlay-root" data-live={hasLiveActivity ? "true" : "false"} data-running={isWorkingActivity ? "true" : "false"} data-status={activityViewStatus}>
      <section className={`notch-wrap ${surfaceState === "open" ? "is-open" : surfaceState === "closing" ? "is-closing" : ""}`} style={notchStyle}>
        <div
          ref={surfaceRef}
          className="halo-surface"
          data-state={surfaceState}
          onMouseEnter={expandPanelOnHover}
          onMouseLeave={scheduleHoverClose}
          onPointerLeave={scheduleHoverClose}
          data-tauri-drag-region="false"
        >
          <svg className="halo-shape" viewBox={`0 0 ${shapeMetrics.width} ${shapeMetrics.height}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path d={notchShapePath} />
          </svg>
          <div className="surface-pill" aria-hidden={surfaceState === "open"}>
            <div className="notch-wing notch-wing-left">
              {hasLiveActivity ? (
                <>
                  <StatusGlyph status={glyphStatus} />
                  <span className="pill-detail">{pillDetail}</span>
                </>
              ) : null}
            </div>
            <div className="camera-spacer" aria-hidden="true" />
            <div className="notch-wing notch-wing-right" aria-hidden="true">
              {hasLiveActivity ? <ActivityMascot activityKind={activityKind} sessionId={activitySession?.conversationId ?? presence.conversationId} status={activityStatus} /> : null}
            </div>
          </div>

          {renderPanel ? <div className="sheet-inner" ref={sheetInnerRef}>
            {setupOpen ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <button className="gear-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false" title="Back to sessions">
                  <ChevronLeft size={14} strokeWidth={2.3} />
                </button>
                <span className="status-slot"><Settings className="setup-icon" size={14} strokeWidth={2.3} /></span>
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
              </div>
            ) : selectedSession ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <button className="gear-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false" title="Back to sessions">
                  <ChevronLeft size={14} strokeWidth={2.3} />
                </button>
                <StatusGlyph status={selectedSession.status} />
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
                <span className="agent-badge">LC</span>
              </div>
            ) : (
              <div className="sheet-header" data-tauri-drag-region="false">
                <StatusGlyph status={glyphStatus} />
                <span className="header-title">{headerLabel}</span>
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
                <span className="spacer" />
                <span className="bridge-dot" data-connected={isConnected} title={connectionTitle} />
                <div className="header-tabs" role="tablist" aria-label="Agent Halo sections">
                  <button className="header-tab" data-active={activeMainTab === "sessions"} type="button" role="tab" aria-selected={activeMainTab === "sessions"} onClick={(event) => { event.stopPropagation(); setSetupOpen(false); setSelectedSessionId(null); setActiveMainTab("sessions"); }} data-tauri-drag-region="false" title="Sessions">
                    <List size={13} strokeWidth={2.3} />
                  </button>
                  <button className="header-tab" data-active={activeMainTab === "usage"} type="button" role="tab" aria-selected={activeMainTab === "usage"} onClick={(event) => { event.stopPropagation(); setSetupOpen(false); setSelectedSessionId(null); setActiveMainTab("usage"); setPanelOpen(true); }} data-tauri-drag-region="false" title="Usage">
                    <BarChart3 size={13} strokeWidth={2.3} />
                  </button>
                  <button className="header-tab" type="button" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false" title="Setup">
                    <Settings size={13} strokeWidth={2.3} />
                  </button>
                </div>
              </div>
            )}
            <div className="sheet-divider" />

            <div className="sheet-body" data-view={activeMainTab === "usage" && !setupOpen && !selectedSession ? "usage" : "default"}>
              {setupOpen ? (
                <div className="setup-body">
                  <div className="setup-row">
                    <span className="bridge-dot" data-connected={isConnected} title={connectionTitle} />
                    <span className="setup-copy">
                      <span className="setup-title">Bridge</span>
                      <span className="setup-detail">{connectionTitle}</span>
                    </span>
                    <button className="pill-btn" type="button" onClick={() => void checkBridge()} data-tauri-drag-region="false">
                      <Check size={12} strokeWidth={2.3} />
                      Check
                    </button>
                  </div>
                  <div className="setup-row">
                    <span className="status-slot"><Download className="setup-icon" size={14} strokeWidth={2.3} /></span>
                    <span className="setup-copy">
                      <span className="setup-title">Letta mod</span>
                      <span className="setup-detail">
                        {modStatus.installed === true
                          ? `Installed · ${shortenPath(modStatus.path)}`
                          : modStatus.installed === false
                            ? `Not installed · ${shortenPath(modStatus.path)}`
                            : canUseNativeControls
                              ? "Checking install state"
                              : "Tauri runtime needed"}
                      </span>
                    </span>
                    <button className="pill-btn accent" type="button" onClick={() => void installMod()} data-tauri-drag-region="false">
                      <Download size={12} strokeWidth={2.3} />
                      {modStatus.installed ? "Reinstall" : "Install"}
                    </button>
                  </div>
                  <div className="setup-row passive">
                    <span className="status-slot"><ArrowRight className="setup-icon" size={14} strokeWidth={2.3} /></span>
                    <span className="setup-copy">
                      <span className="setup-title">{setupGuidance.title}</span>
                      <span className="setup-detail">{setupGuidance.detail}</span>
                    </span>
                  </div>
                  <div className="setup-row passive">
                    <span className="status-slot"><Focus className="setup-icon" size={14} strokeWidth={2.3} /></span>
                    <span className="setup-copy">
                      <span className="setup-title">Session controls</span>
                      <span className="setup-detail">
                        {canUseNativeControls
                          ? "Ghostty focus available · end unavailable"
                          : capabilities.sessionActions.focusTerminal || capabilities.sessionActions.endSession
                            ? "Focus/end available from bridge"
                            : "Focus/end unavailable in current bridge"}
                      </span>
                    </span>
                  </div>
                  {nativeAction.message ? (
                    <div className="notice-row" data-online={nativeAction.bridgeOnline === true}>{nativeAction.message}</div>
                  ) : null}
                </div>
              ) : selectedSession ? (
                <div className="detail-body">
                  <div className="detail-stats">
                    <span className={`status-text status-text-${selectedSession.status}`}>{selectedSession.status}</span>
                    <span>{formatTime(selectedSession.lastActivityAt)}</span>
                    <span>{selectedSession.permissionMode}</span>
                  </div>
                  <div className="detail-path" title={selectedSession.cwd}>{shortenPath(selectedSession.cwd)}</div>
                  {canUseNativeControls ? (
                    <div className="capability-note">Focus matches Ghostty terminal cwd/title and selects its tab</div>
                  ) : (
                    <div className="capability-note">Focus needs the desktop runtime</div>
                  )}
                  {sessionAction.message ? (
                    <div className="notice-row compact" data-online={sessionAction.ok === true}>{sessionAction.message}</div>
                  ) : null}
                  <div className="detail-section-label">Recent activity</div>
                  {selectedSessionActivityEvents.length === 0 ? (
                    <div className="empty-text small">No events captured yet</div>
                  ) : (
                    <div className="action-list">
                      {selectedSessionActivityEvents.map((event) => {
                        const activity = getEventActivity(event);

                        return (
                          <div className="action-row" data-kind={activity.kind} key={event.id}>
                            <span className="action-tool">{activity.label}</span>
                            <span className="action-detail">{activity.detail}</span>
                            <span className="session-time">{formatTime(event.timestamp)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : activeMainTab === "usage" ? (
                <AgentUsageList usages={agentUsages} onRefresh={refreshAgentUsage} settings={usageSettings} onSettingsChange={updateUsageSettings} />
              ) : sessions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-glyph">◌</div>
                  <div className="empty-text">Waiting for Letta Code</div>
                  <button className="btn accent" type="button" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false">
                    <Settings size={13} strokeWidth={2.3} />
                    Open setup
                  </button>
                </div>
              ) : (
                <>
                  <ul className="session-list">
                    {sessionGroups.map((group) => {
                      const session = group.primarySession;
                      const isGrouped = group.sessions.length > 1;
                      const rowTitle = isGrouped ? `${group.workspacePath ?? group.workspace} · ${group.sessions.length} sessions` : session.conversationId;

                      return (
                      <li className={`session-row ${isGrouped ? "session-group" : ""} ${group.status === "done" ? "ended" : ""}`} key={group.key} title={rowTitle} onClick={() => openSession(session.conversationId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openSession(session.conversationId); }} role="button" tabIndex={0}>
                        <SessionMascot activityKind={group.activityKind} sessionId={session.conversationId} status={group.status} />
                        <span className="session-label">
                          <span className="session-main-line">
                            <span className="agent-badge">{isGrouped ? `×${group.sessions.length}` : "LC"}</span>
                            <span className="session-project">{group.project}</span>
                            <span className="session-meta">{isGrouped ? group.detail : session.detail}</span>
                          </span>
                          <span className="session-folder">{group.workspace}</span>
                        </span>
                        <span className="spacer" />
                        <span className="session-time">{formatTime(group.lastActivityAt)}</span>
                        <button
                          className="row-btn row-focus"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void focusSelectedSession(session);
                          }}
                          data-tauri-drag-region="false"
                          title="Focus session in Ghostty"
                        >
                          <Focus size={11} strokeWidth={2.4} />
                          Focus
                        </button>
                        {group.status === "done" ? (
                          <button
                            className="row-btn danger"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (isGrouped) dismissSessionGroup(group);
                              else dismissSession(session.conversationId);
                            }}
                            data-tauri-drag-region="false"
                          title={isGrouped ? "Dismiss workspace sessions" : "Dismiss session"}
                        >
                            <X size={12} strokeWidth={2.5} />
                        </button>
                        ) : null}
                      </li>
                      );
                    })}
                  </ul>

                  <div className="sheet-divider soft" />

                  <div className="event-list" aria-label="Recent Agent Halo events">
                    {recentEvents.slice(0, 4).map((event) => (
                      <div className="event-row" key={event.id}>
                        <span className="event-time">{formatTime(event.timestamp)}</span>
                        <span className="event-type">{event.type}</span>
                        <span className="event-detail">{getEventDetail(event)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {(setupOpen || selectedSession || activitySession?.status === "done") ? (
              <div className="sheet-footer">
                <span className="footer-meta">{workspace} · {model}</span>
                <span className="spacer" />
                {setupOpen ? (
                  <div className="footer-actions">
                    <button className="pill-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false">
                      <List size={12} strokeWidth={2.3} />
                      Sessions
                    </button>
                  </div>
                ) : selectedSession ? (
                  <div className="footer-actions">
                    <button className="pill-btn accent" type="button" onClick={() => void focusSelectedSession(selectedSession)} data-tauri-drag-region="false">
                      <Focus size={12} strokeWidth={2.3} />
                      Focus
                    </button>
                    {selectedSession.status === "done" ? (
                      <button className="pill-btn danger" type="button" onClick={() => dismissSession(selectedSession.conversationId)} data-tauri-drag-region="false">
                        <X size={12} strokeWidth={2.4} />
                        Dismiss
                      </button>
                    ) : null}
                    <button className="pill-btn danger" type="button" onClick={() => deleteSession(selectedSession.conversationId)} data-tauri-drag-region="false" title="Delete stuck session locally">
                      <Trash2 size={12} strokeWidth={2.3} />
                      Delete
                    </button>
                    <button className="pill-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false">
                      <List size={12} strokeWidth={2.3} />
                      Sessions
                    </button>
                  </div>
                ) : null}
                {activitySession?.status === "done" ? (
                  <button className="pill-btn accent" type="button" onClick={(event) => { event.stopPropagation(); acknowledgeDone(); }} data-tauri-drag-region="false">
                    <Check size={12} strokeWidth={2.4} />
                    Acknowledge
                  </button>
                ) : null}
              </div>
            ) : null}
          </div> : null}
        </div>
      </section>
    </main>
  );
};

declare global {
  interface Window {
    __AGENT_HALO_HOME__?: string;
    __TAURI_INTERNALS__?: unknown;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
