import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
const PANEL_WINDOW_HEIGHT = 440;
const ACTIVITY_COLLAPSE_MS = 220;
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

type SessionEventRegistry = Record<string, AgentHaloEvent[]>;
type DismissedSessionRegistry = Record<string, number>;
type DeletedSessionRegistry = Record<string, number>;

const estimateLiveActivityWingWidth = (label: string): number => {
  const textWidth = Math.ceil(label.length * 5.6);
  return Math.min(MAX_LIVE_ACTIVITY_WING_WIDTH, Math.max(MIN_LIVE_ACTIVITY_WING_WIDTH, LIVE_ACTIVITY_TEXT_WIDTH_BUFFER + textWidth));
};

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

const getEventDetail = (event: AgentHaloEvent): string => {
  switch (event.type) {
    case "bridge_ready":
      return `bridge :${event.data.port}`;
    case "conversation_open":
      return `open · ${event.data.reason}`;
    case "conversation_close":
      return `closed · ${event.data.reason}`;
    case "turn_start":
      return `turn · ${event.data.inputCount} input`;
    case "turn_stop":
      return event.data.message ? `done · ${event.data.message}` : "done";
    case "tool_start":
      return `tool · ${event.data.toolName}`;
    case "bridge_error":
      return `error · ${event.data.message}`;
  }
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

const getEventSessionDetail = (event: AgentHaloEvent): string => {
  switch (event.type) {
    case "tool_start":
      return event.data.toolName;
    case "turn_start":
      return "thinking";
    case "turn_stop":
    case "conversation_close":
      return "done";
    case "bridge_error":
      return "error";
    default:
      return "idle";
  }
};

const StatusGlyph = ({ status }: { status: ISessionSummary["status"] }) => {
  if (status === "working") return <span className="status-slot"><span className="glyph-pulse">✱</span></span>;
  if (status === "waiting") return <span className="status-slot"><span className="glyph-waiting">!</span></span>;
  if (status === "done") return <span className="status-slot"><span className="glyph-check">✓</span></span>;
  return <span className="status-slot"><span className={`status-dot status-${status}`} /></span>;
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
    const workspacePath = getSessionWorkspacePath(sessionEvents, latestEvent.cwd);
    sessions.set(conversationId, {
      conversationId,
      project: projectName(workspacePath ?? latestEvent.cwd),
      workspace: shortenPath(workspacePath ?? latestEvent.cwd),
      workspacePath,
      detail: getEventSessionDetail(latestEvent),
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
  const [acknowledgedConversationId, setAcknowledgedConversationId] = useState<string | null>(null);
  const [nativeAction, setNativeAction] = useState<INativeActionState>({ bridgeOnline: null, message: null });
  const [sessionAction, setSessionAction] = useState<ISessionActionState>({ ok: null, message: null });
  const [panelOpen, setPanelOpen] = useState(DEMO_MODE);
  const [renderPanel, setRenderPanel] = useState(DEMO_MODE);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [hoverExpandSuppressed, setHoverExpandSuppressed] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [modStatus, setModStatus] = useState<IModStatus>({ path: null, installed: null });
  const [notchMetrics, setNotchMetrics] = useState<INotchMetrics>({ cameraWidth: DEFAULT_CAMERA_NOTCH_WIDTH, closedHeight: DEFAULT_CLOSED_NOTCH_HEIGHT });
  const [nativeClosedSurfaceWidth, setNativeClosedSurfaceWidth] = useState(DEFAULT_CAMERA_NOTCH_WIDTH);
  const [dismissedSessionIds, setDismissedSessionIds] = useState<DismissedSessionRegistry>(readDismissedSessionIds);
  const [deletedSessionIds, setDeletedSessionIds] = useState<DeletedSessionRegistry>(readDeletedSessionIds);
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
  const headerLabel = setupOpen ? "Setup" : selectedSession ? selectedSession.project : sessions.length === 0 ? "Agent Halo" : sessions.length === 1 ? "1 session" : `${sessions.length} sessions`;
  const activitySession =
    sessions.find((session) => session.status === "working") ??
    sessions.find((session) => session.status === "waiting") ??
    sessions.find((session) => session.status === "done" && session.conversationId !== acknowledgedConversationId) ??
    null;
  const activityStatus = activitySession?.status ?? getGlyphStatus(displayView.status);
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
    "--pill-text-width": `${Math.max(0, liveActivityWingWidth - LIVE_ACTIVITY_TEXT_WIDTH_BUFFER)}px`,
  } as CSSProperties & Record<"--closed-width" | "--closed-height" | "--camera-width" | "--pill-text-width", string>;
  const shouldAutoOpen = activityStatus === "error";
  const surfaceState = renderPanel ? (panelOpen ? "open" : "closing") : "closed";
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
    let cancelled = false;

    const resizeNativePanel = async (open: boolean) => {
      if (!canUseNativeControls) return;
      await invoke("set_panel_open", {
        open,
        width: open ? PANEL_WINDOW_WIDTH : nativeClosedSurfaceWidth,
        height: open ? PANEL_WINDOW_HEIGHT : closedSurfaceHeight,
      });
    };

    if (panelOpen) {
      void (async () => {
        await resizeNativePanel(true);
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
  }, [canUseNativeControls, closedSurfaceHeight, nativeClosedSurfaceWidth, panelOpen, renderPanel]);

  const closePanel = ({ suppressHover }: { suppressHover: boolean }) => {
    setHoverExpanded(false);
    if (suppressHover) setHoverExpandSuppressed(true);
    setSelectedSessionId(null);
    setSetupOpen(false);
    setPanelOpen(false);
  };

  const openPanelExplicitly = () => {
    setHoverExpanded(false);
    setHoverExpandSuppressed(false);
    setPanelOpen(true);
  };

  const expandPanelOnHover = () => {
    if (renderPanel || panelOpen || hoverExpandSuppressed) return;
    setHoverExpanded(true);
    setPanelOpen(true);
  };

  const handleSurfaceMouseLeave = () => {
    setHoverExpandSuppressed(false);
    if (!hoverExpanded || shouldAutoOpen) return;
    closePanel({ suppressHover: false });
  };

  const collapsePanel = () => closePanel({ suppressHover: true });

  const openSession = (conversationId: string) => {
    setHoverExpanded(false);
    setSetupOpen(false);
    setSessionAction({ ok: null, message: null });
    setSelectedSessionId(conversationId);
    setPanelOpen(true);
  };

  const openSetup = () => {
    setHoverExpanded(false);
    setSelectedSessionId(null);
    setSetupOpen(true);
    setPanelOpen(true);
  };

  const backToSessions = () => {
    setSelectedSessionId(null);
    setSetupOpen(false);
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

  const focusSelectedSession = async (session: ISessionDetail) => {
    if (!canUseNativeControls) {
      setSessionAction({ ok: false, message: "Focus needs the desktop runtime" });
      return;
    }

    try {
      const message = await invoke<string>("focus_terminal", {
        conversationId: session.conversationId,
        cwd: session.cwd,
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
      <section className={`notch-wrap ${panelOpen ? "is-open" : renderPanel ? "is-closing" : ""}`} style={notchStyle}>
        <div
          className="halo-surface"
          data-state={surfaceState}
          onMouseEnter={expandPanelOnHover}
          onMouseLeave={handleSurfaceMouseLeave}
          onClick={!renderPanel ? openPanelExplicitly : undefined}
          onKeyDown={!renderPanel ? (event) => { if (event.key === "Enter" || event.key === " ") openPanelExplicitly(); } : undefined}
          role={!renderPanel ? "button" : undefined}
          tabIndex={!renderPanel ? 0 : undefined}
          aria-label={!renderPanel ? "Open Agent Halo" : undefined}
          data-tauri-drag-region="false"
        >
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
              {hasLiveActivity ? <span className="activity-bars"><span /><span /><span /></span> : null}
            </div>
          </div>

          {renderPanel ? <div className="sheet-inner">
            {setupOpen ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <button className="gear-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false" title="Back to sessions">
                  ‹
                </button>
                <span className="status-slot"><span className="setup-glyph">⌁</span></span>
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
              </div>
            ) : selectedSession ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <button className="gear-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false" title="Back to sessions">
                  ‹
                </button>
                <StatusGlyph status={selectedSession.status} />
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
                <span className="agent-badge">LC</span>
              </div>
            ) : (
              <div className="sheet-header" onClick={collapsePanel} data-tauri-drag-region="false" role="button" tabIndex={0} aria-label="Collapse Agent Halo panel" onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") collapsePanel(); }}>
                <StatusGlyph status={glyphStatus} />
                <span className="header-title">{headerLabel}</span>
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
                <span className="spacer" />
                <span className="bridge-dot" data-connected={isConnected} title={connectionTitle} />
                <button className="gear-btn" type="button" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false" title="Setup">
                  ⌁
                </button>
              </div>
            )}
            <div className="sheet-divider" />

            <div className="sheet-body">
              {setupOpen ? (
                <div className="setup-body">
                  <div className="setup-row">
                    <span className="bridge-dot" data-connected={isConnected} title={connectionTitle} />
                    <span className="setup-copy">
                      <span className="setup-title">Bridge</span>
                      <span className="setup-detail">{connectionTitle}</span>
                    </span>
                    <button className="pill-btn" type="button" onClick={() => void checkBridge()} data-tauri-drag-region="false">
                      Check
                    </button>
                  </div>
                  <div className="setup-row">
                    <span className="status-slot"><span className="setup-glyph">◆</span></span>
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
                      {modStatus.installed ? "Reinstall" : "Install"}
                    </button>
                  </div>
                  <div className="setup-row passive">
                    <span className="status-slot"><span className="setup-glyph">➜</span></span>
                    <span className="setup-copy">
                      <span className="setup-title">{setupGuidance.title}</span>
                      <span className="setup-detail">{setupGuidance.detail}</span>
                    </span>
                  </div>
                  <div className="setup-row passive">
                    <span className="status-slot"><span className="setup-glyph">↗</span></span>
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
                  {selectedSession.events.length === 0 ? (
                    <div className="empty-text small">No events captured yet</div>
                  ) : (
                    <div className="action-list">
                      {selectedSession.events.slice(0, 16).map((event) => (
                        <div className="action-row" key={event.id}>
                          <span className="action-tool">{event.type}</span>
                          <span className="action-detail">{getEventDetail(event)}</span>
                          <span className="session-time">{formatTime(event.timestamp)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : sessions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-glyph">◌</div>
                  <div className="empty-text">Waiting for Letta Code</div>
                  <button className="btn accent" type="button" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false">
                    Open setup
                  </button>
                </div>
              ) : (
                <>
                  <ul className="session-list">
                    {sessions.map((session) => (
                      <li className={`session-row ${session.status === "done" ? "ended" : ""}`} key={session.conversationId} title={session.conversationId} onClick={() => openSession(session.conversationId)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openSession(session.conversationId); }} role="button" tabIndex={0}>
                        <StatusGlyph status={session.status} />
                        <span className="session-label">
                          <span className="session-main-line">
                            <span className="agent-badge">LC</span>
                            <span className="session-project">{session.project}</span>
                            <span className="session-meta">{session.detail}</span>
                          </span>
                          <span className="session-folder">{session.workspace}</span>
                        </span>
                        <span className="spacer" />
                        <span className="session-time">{formatTime(session.lastActivityAt)}</span>
                        {session.status === "done" ? (
                          <button
                            className="row-btn danger"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              dismissSession(session.conversationId);
                            }}
                            data-tauri-drag-region="false"
                            title="Dismiss session"
                          >
                            ×
                          </button>
                        ) : null}
                      </li>
                    ))}
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
                      Sessions
                    </button>
                  </div>
                ) : selectedSession ? (
                  <div className="footer-actions">
                    <button className="pill-btn accent" type="button" onClick={() => void focusSelectedSession(selectedSession)} data-tauri-drag-region="false">
                      Focus
                    </button>
                    {selectedSession.status === "done" ? (
                      <button className="pill-btn danger" type="button" onClick={() => dismissSession(selectedSession.conversationId)} data-tauri-drag-region="false">
                        Dismiss
                      </button>
                    ) : null}
                    <button className="pill-btn danger" type="button" onClick={() => deleteSession(selectedSession.conversationId)} data-tauri-drag-region="false" title="Delete stuck session locally">
                      Delete
                    </button>
                    <button className="pill-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false">
                      Sessions
                    </button>
                  </div>
                ) : null}
                {activitySession?.status === "done" ? (
                  <button className="pill-btn accent" type="button" onClick={(event) => { event.stopPropagation(); acknowledgeDone(); }} data-tauri-drag-region="false">
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
