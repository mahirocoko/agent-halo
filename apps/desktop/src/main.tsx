import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";
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
const DEMO_MODE = new URLSearchParams(window.location.search).has("demo");
const NOTCH_WIDTH = 200;
const NOTCH_HEIGHT = 32;
const PILL_WINDOW_WIDTH = 272;
const PILL_WINDOW_HEIGHT = 64;
const PANEL_WINDOW_WIDTH = 340;
const PANEL_WINDOW_HEIGHT = 314;
const DISMISSED_SESSIONS_STORAGE_KEY = "agent-halo.dismissed-sessions";
const MAX_DISMISSED_SESSION_IDS = 80;

interface IConnectionState {
  status: "connecting" | "connected" | "disconnected" | "error";
  message: string | null;
}

interface INativeActionState {
  bridgeOnline: boolean | null;
  message: string | null;
}

interface IModStatus {
  path: string | null;
  installed: boolean | null;
}

interface ISessionSummary {
  conversationId: string;
  project: string;
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

interface IStatusView {
  status: AgentHaloPresenceStatus | "stale";
  label: string;
  isStale: boolean;
  staleForMs: number;
}

const notchPath = (width: number, height: number, topRadius = 8, bottomRadius = 10): string =>
  [
    "M 0 0",
    `Q ${topRadius} 0 ${topRadius} ${topRadius}`,
    `L ${topRadius} ${height - bottomRadius}`,
    `Q ${topRadius} ${height} ${topRadius + bottomRadius} ${height}`,
    `L ${width - topRadius - bottomRadius} ${height}`,
    `Q ${width - topRadius} ${height} ${width - topRadius} ${height - bottomRadius}`,
    `L ${width - topRadius} ${topRadius}`,
    `Q ${width - topRadius} 0 ${width} 0`,
    "Z",
  ].join(" ");


const readDismissedSessionIds = (): Set<string> => {
  try {
    const raw = window.localStorage.getItem(DISMISSED_SESSIONS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string").slice(-MAX_DISMISSED_SESSION_IDS));
  } catch {
    return new Set();
  }
};

const writeDismissedSessionIds = (ids: Set<string>) => {
  try {
    const bounded = Array.from(ids).slice(-MAX_DISMISSED_SESSION_IDS);
    window.localStorage.setItem(DISMISSED_SESSIONS_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Ignore storage errors; dismissal still works for the current runtime session.
  }
};

const NotchShape = ({ children }: { children: ReactNode }) => (
  <div className="notch" style={{ width: NOTCH_WIDTH, height: NOTCH_HEIGHT }}>
    <svg className="notch-bg" width={NOTCH_WIDTH} height={NOTCH_HEIGHT} viewBox={`0 0 ${NOTCH_WIDTH} ${NOTCH_HEIGHT}`} aria-hidden="true">
      <path d={notchPath(NOTCH_WIDTH, NOTCH_HEIGHT)} fill="#000" />
    </svg>
    <div className="notch-content">{children}</div>
  </div>
);

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

const getEventSessionStatus = (event: AgentHaloEvent): ISessionSummary["status"] => {
  switch (event.type) {
    case "conversation_close":
      return "done";
    case "turn_start":
    case "tool_start":
      return "working";
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
      return { ...base, type: "conversation_close", data: { durationMs: 184000, messageCount: 14, reason: "quit", toolCallCount: 6 } };
  }
};

const buildSessionSummaries = (events: AgentHaloEvent[], presence: IAgentHaloPresence, view: IStatusView): ISessionSummary[] => {
  const sessions = new Map<string, ISessionSummary>();

  for (const event of events) {
    if (!event.conversationId || sessions.has(event.conversationId)) continue;
    sessions.set(event.conversationId, {
      conversationId: event.conversationId,
      project: projectName(event.cwd),
      detail: getEventSessionDetail(event),
      status: getEventSessionStatus(event),
      lastActivityAt: event.timestamp,
    });
  }

  if (presence.conversationId) {
    sessions.set(presence.conversationId, {
      conversationId: presence.conversationId,
      project: projectName(presence.cwd),
      detail: presence.activeToolName ?? getStatusCopy(view).toLowerCase(),
      status: getGlyphStatus(view.status),
      lastActivityAt: presence.lastEventAt ?? new Date(0).toISOString(),
    });
  }

  return [...sessions.values()].slice(0, 5);
};


const buildSessionDetail = (
  conversationId: string | null,
  sessions: ISessionSummary[],
  events: AgentHaloEvent[],
  presence: IAgentHaloPresence,
  view: IStatusView,
): ISessionDetail | null => {
  if (!conversationId) return null;

  const summary = sessions.find((session) => session.conversationId === conversationId);
  if (!summary) return null;

  const sessionEvents = events.filter((event) => event.conversationId === conversationId);
  const latestEvent = sessionEvents[0];
  const isCurrent = presence.conversationId === conversationId;

  return {
    ...summary,
    agentName: (isCurrent ? presence.agentName : latestEvent?.agentName) ?? "Mahiro Code",
    cwd: (isCurrent ? presence.cwd : latestEvent?.cwd) ?? "No workspace",
    model: (isCurrent ? presence.model : latestEvent?.model) ?? "Letta Code",
    permissionMode: (isCurrent ? presence.permissionMode : latestEvent?.permissionMode) ?? "—",
    detail: isCurrent ? presence.activeToolName ?? getStatusCopy(view).toLowerCase() : summary.detail,
    events: sessionEvents,
  };
};

const applyEvent = (presence: IAgentHaloPresence, event: AgentHaloEvent) => reducePresence(presence, event);

const appendRecentEvent = (events: AgentHaloEvent[], event: AgentHaloEvent): AgentHaloEvent[] =>
  [event, ...events].slice(0, MAX_RECENT_EVENTS);

const useAgentHaloPresence = () => {
  const [presence, setPresence] = useState<IAgentHaloPresence>(() => createInitialPresence());
  const [recentEvents, setRecentEvents] = useState<AgentHaloEvent[]>([]);
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
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
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
        setPresence((current) => reducePresence(current, event));
        setRecentEvents((current) => appendRecentEvent(current, event));
      } catch {
        setConnection({ status: "error", message: "Received malformed bridge event" });
      }
    };

    for (const type of ["bridge_ready", "conversation_open", "conversation_close", "turn_start", "tool_start", "bridge_error"]) {
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

  return { capabilities, connection, presence, recentEvents, refreshCapabilities, view };
};

const App = () => {
  const { capabilities, connection, presence, recentEvents, refreshCapabilities, view } = useAgentHaloPresence();
  const [acknowledgedConversationId, setAcknowledgedConversationId] = useState<string | null>(null);
  const [nativeAction, setNativeAction] = useState<INativeActionState>({ bridgeOnline: null, message: null });
  const [panelOpen, setPanelOpen] = useState(DEMO_MODE);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [modStatus, setModStatus] = useState<IModStatus>({ path: null, installed: null });
  const [dismissedSessionIds, setDismissedSessionIds] = useState<Set<string>>(readDismissedSessionIds);
  const displayView =
    view.status === "closed" && (acknowledgedConversationId === presence.conversationId || (presence.conversationId ? dismissedSessionIds.has(presence.conversationId) : false))
      ? ({ ...view, status: "idle", label: "idle" } satisfies IStatusView)
      : view;
  const canUseNativeControls = typeof window.__TAURI_INTERNALS__ !== "undefined";
  const glyphStatus = getGlyphStatus(displayView.status);
  const isConnected = connection.status === "connected";
  const connectionTitle = DEMO_MODE ? "Demo mode" : (connection.message ?? connection.status);
  const workspace = shortenPath(presence.cwd);
  const project = projectName(presence.cwd);
  const model = presence.model?.split("/").slice(-1)[0] ?? "Letta Code";
  const sessions = useMemo(
    () =>
      buildSessionSummaries(recentEvents, presence, displayView).filter(
        (session) =>
          !dismissedSessionIds.has(session.conversationId) ||
          (session.conversationId === presence.conversationId && !["idle", "closed"].includes(displayView.status)),
      ),
    [dismissedSessionIds, displayView, presence.conversationId, presence, recentEvents],
  );
  const selectedSession = useMemo(
    () => buildSessionDetail(selectedSessionId, sessions, recentEvents, presence, displayView),
    [displayView, presence, recentEvents, selectedSessionId, sessions],
  );
  const headerLabel = setupOpen ? "Setup" : selectedSession ? selectedSession.project : sessions.length === 0 ? "Agent Halo" : sessions.length === 1 ? "1 session" : `${sessions.length} sessions`;
  const pillDetail = presence.activeToolName ?? (displayView.status === "idle" ? project : getStatusCopy(displayView));
  const shouldAutoOpen = ["thinking", "tool-running", "stale", "closed", "error"].includes(displayView.status);
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
    if (shouldAutoOpen) setPanelOpen(true);
  }, [shouldAutoOpen]);

  useEffect(() => {
    if (!canUseNativeControls) return;
    void invoke("set_panel_open", {
      open: panelOpen,
      width: panelOpen ? PANEL_WINDOW_WIDTH : PILL_WINDOW_WIDTH,
      height: panelOpen ? PANEL_WINDOW_HEIGHT : PILL_WINDOW_HEIGHT,
    });
  }, [canUseNativeControls, panelOpen]);

  const togglePanel = () => setPanelOpen((open) => !open);
  const collapsePanel = () => {
    setSelectedSessionId(null);
    setSetupOpen(false);
    setPanelOpen(false);
  };

  const openSession = (conversationId: string) => {
    setSetupOpen(false);
    setSelectedSessionId(conversationId);
    setPanelOpen(true);
  };

  const openSetup = () => {
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
      const next = new Set(current).add(conversationId);
      writeDismissedSessionIds(next);
      return next;
    });
    if (conversationId === presence.conversationId) setAcknowledgedConversationId(conversationId);
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
    setAcknowledgedConversationId(presence.conversationId);
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
      setNativeAction({ bridgeOnline: nativeAction.bridgeOnline, message: `Installed → ${shortenPath(path)}` });
    } catch (error) {
      setNativeAction({
        bridgeOnline: nativeAction.bridgeOnline,
        message: error instanceof Error ? error.message : "Install failed; run pnpm mod:install",
      });
    }
  };

  useEffect(() => {
    if (setupOpen) void loadModStatus();
  }, [setupOpen]);

  return (
    <main className="overlay-root" data-status={displayView.status} data-tauri-drag-region>
      <section className="notch-wrap" data-tauri-drag-region>
        <button className="notch-button" type="button" onClick={togglePanel} data-tauri-drag-region="false" aria-label={panelOpen ? "Collapse Agent Halo" : "Open Agent Halo"}>
          <NotchShape>
          <div className="pill-content">
            <StatusGlyph status={glyphStatus} />
            <span className="pill-detail">{pillDetail}</span>
          </div>
          </NotchShape>
        </button>

        {panelOpen ? <div className="sheet view-panel docked" data-tauri-drag-region>
          <div className="sheet-inner">
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
                        {capabilities.sessionActions.focusTerminal || capabilities.sessionActions.endSession
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
                  {!capabilities.sessionActions.focusTerminal && !capabilities.sessionActions.endSession ? (
                    <div className="capability-note">Focus/end controls need bridge session actions</div>
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
                          <span className="agent-badge">LC</span>
                          <span className="session-project">{session.project}</span>
                          <span className="session-meta">{session.detail}</span>
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
                  {selectedSession.status === "done" ? (
                    <button className="pill-btn danger" type="button" onClick={() => dismissSession(selectedSession.conversationId)} data-tauri-drag-region="false">
                      Dismiss
                    </button>
                  ) : null}
                  <button className="pill-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false">
                    Sessions
                  </button>
                </div>
              ) : (
                <button className="pill-btn" type="button" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false">
                  Setup
                </button>
              )}
              {displayView.status === "closed" && acknowledgedConversationId !== presence.conversationId ? (
                <button className="pill-btn accent" type="button" onClick={(event) => { event.stopPropagation(); acknowledgeDone(); }} data-tauri-drag-region="false">
                  Acknowledge
                </button>
              ) : null}
            </div>
          </div>
        </div> : null}
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
