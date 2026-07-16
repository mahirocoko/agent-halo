import { invoke } from "@tauri-apps/api/core";
import { BarChart3, Check, ChevronLeft, Focus, List, Settings, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import type { AgentHaloPresenceStatus } from "@agent-halo/protocol";
import { ActivityMascot } from "./features/session/HaloMascot";
import { SessionContextSummary, StatusGlyph, WorkspaceSessionGroupItem } from "./features/session/components";
import {
  formatTime,
  getEventActivity,
  getEventDetail,
  projectName,
  shortenPath,
} from "./features/session/activity";
import { DONE_SIGNAL_MS, STALE_AFTER_MS } from "./features/session/constants";
import { getUniqueSortedEvents } from "./features/session/eventRegistry";
import {
  isDeletedAfter,
  isDismissedAfter,
  readDeletedSessionIds,
  readDismissedSessionIds,
  writeDeletedSessionIds,
  writeDismissedSessionIds,
  writeSessionEventRegistry,
} from "./features/session/persistence";
import {
  buildSessionDetail,
  buildSessionSummaries,
  buildWorkspaceSessionGroups,
  shouldKeepDisplayAwakeForActivity,
} from "./features/session/selectors";
import type { ActivityKind, DeletedSessionRegistry, DismissedSessionRegistry, ISessionDetail, ISessionSummary, IWorkspaceSessionGroup } from "./features/session/types";
import { useAgentHaloPresence } from "./features/presence/useAgentHaloPresence";
import { SetupPanel } from "./features/setup/SetupPanel";
import { readUsageSettings, writeUsageSettings } from "./features/usage/adapters";
import { AgentUsageList } from "./features/usage/components";
import type { IUsageSettings } from "./features/usage/types";
import { useAgentUsageList } from "./features/usage/useAgentUsageList";
import "./styles.css";

const KEEP_AWAKE_STORAGE_KEY = "agent-halo.keep-awake-while-working";
const SEARCH_PARAMS = new URLSearchParams(window.location.search);
const DEMO_MODE = SEARCH_PARAMS.has("demo");
const DEMO_SCENARIO = SEARCH_PARAMS.get("demoScenario");
const DEFAULT_CAMERA_NOTCH_WIDTH = 184;
const DEFAULT_CLOSED_NOTCH_HEIGHT = 36;
const MIN_LIVE_ACTIVITY_WING_WIDTH = 66;
const MAX_LIVE_ACTIVITY_WING_WIDTH = 110;
const LIVE_ACTIVITY_TEXT_WIDTH_BUFFER = 52;
const PANEL_WINDOW_WIDTH = 560;
const PANEL_MIN_HEIGHT = 218;
const PANEL_MAX_HEIGHT = 440;
const ACTIVITY_COLLAPSE_MS = 220;
const HOVER_OPEN_DELAY_MS = 24;
const HOVER_CLOSE_DELAY_MS = 170;
const KEEP_AWAKE_RETRY_DELAYS_MS = [750, 2_500] as const;
const CLOSED_TOP_SHOULDER_RADIUS = 11;
const OPEN_TOP_SHOULDER_RADIUS = 19;
const CLOSED_BOTTOM_RADIUS = 15;
const PANEL_BOTTOM_RADIUS = 22;
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

type MainPanelTab = "sessions" | "usage";

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

const getGlyphStatus = (status: IStatusView["status"]): ISessionSummary["status"] => {
  if (status === "thinking" || status === "tool-running") return "working";
  if (status === "stale") return "inactive";
  if (status === "attention") return "attention";
  if (status === "closed") return "done";
  if (status === "error" || status === "offline") return "error";
  return "idle";
};

const readKeepAwakeEnabled = (): boolean => {
  try { return window.localStorage.getItem(KEEP_AWAKE_STORAGE_KEY) === "true"; } catch { return false; }
};
const writeKeepAwakeEnabled = (enabled: boolean) => {
  try { window.localStorage.setItem(KEEP_AWAKE_STORAGE_KEY, `${enabled}`); } catch { /* current runtime still owns state */ }
};

const App = () => {
  const { capabilities, connection, lastLiveEvent, now, presence, recentEvents, refreshCapabilities, sessionEventRegistry, setSessionEventRegistry, view } = useAgentHaloPresence({ demoMode: DEMO_MODE, demoScenario: DEMO_SCENARIO });
  const [usageSettings, setUsageSettings] = useState<IUsageSettings>(readUsageSettings);
  const { refresh: refreshAgentUsage, usages: agentUsages } = useAgentUsageList(usageSettings, DEMO_MODE);
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
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(readKeepAwakeEnabled);
  const [keepAwakeActive, setKeepAwakeActive] = useState(false);
  const [keepAwakeError, setKeepAwakeError] = useState<string | null>(null);
  const [expandedSessionGroupKeys, setExpandedSessionGroupKeys] = useState<Set<string>>(() => new Set());
  const [clearCompletedArmed, setClearCompletedArmed] = useState(false);
  const [pendingRemoveHistoryId, setPendingRemoveHistoryId] = useState<string | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const sheetInnerRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const returnSessionIdRef = useRef<string | null>(null);
  const shouldFocusPanelRef = useRef(false);
  const keyboardNavigationRef = useRef(false);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const keepAwakeRequestRef = useRef<Promise<unknown>>(Promise.resolve());
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
      buildSessionSummaries(sessionEventRegistry, presence, now).filter(
        (session) =>
          !isDeletedAfter(deletedSessionIds, session.conversationId, session.lastActivityAt) &&
          (!isDismissedAfter(dismissedSessionIds, session.conversationId, session.lastActivityAt) ||
            (session.conversationId === presence.conversationId && !["idle", "closed"].includes(displayView.status))),
      ),
    [deletedSessionIds, dismissedSessionIds, displayView.status, now, presence, sessionEventRegistry],
  );
  const selectedSession = useMemo(
    () => buildSessionDetail(selectedSessionId, sessions, sessionEventRegistry, presence),
    [presence, selectedSessionId, sessionEventRegistry, sessions],
  );
  const selectedSessionActivityEvents = useMemo(() => {
    if (!selectedSession) return [];
    const fallbackEvents = recentEvents.filter((event) => event.conversationId === selectedSession.conversationId);
    return getUniqueSortedEvents([...selectedSession.events, ...fallbackEvents]).slice(0, 16);
  }, [recentEvents, selectedSession]);
  const sessionGroups = useMemo(() => buildWorkspaceSessionGroups(sessions), [sessions]);
  const activeSessionGroups = useMemo(
    () => buildWorkspaceSessionGroups(sessions.filter((session) => session.status !== "done")),
    [sessions],
  );
  const completedSessions = useMemo(() => sessions.filter((session) => session.status === "done"), [sessions]);
  const completedSessionGroups = useMemo(() => buildWorkspaceSessionGroups(completedSessions), [completedSessions]);

  useEffect(() => {
    if (!clearCompletedArmed) return undefined;
    const timer = window.setTimeout(() => setClearCompletedArmed(false), 4_000);
    return () => window.clearTimeout(timer);
  }, [clearCompletedArmed]);

  useEffect(() => {
    setPendingRemoveHistoryId(null);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!presence.conversationId) return;
    if (acknowledgedConversationId !== presence.conversationId) return;
    if (view.status !== "thinking" && view.status !== "tool-running" && view.status !== "attention" && view.status !== "stale") return;
    setAcknowledgedConversationId(null);
  }, [acknowledgedConversationId, presence.conversationId, view.status]);

  useEffect(() => {
    if (!lastLiveEvent?.conversationId) return;
    if (!["turn_start", "tool_start", "tool_end", "compact_start", "compact_end", "llm_start", "llm_end", "turn_stop", "turn_complete", "attention_requested"].includes(lastLiveEvent.type)) return;

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
    sessions.find((session) => session.status === "attention") ??
    sessions.find((session) => session.status === "working") ??
    sessions.find((session) => session.status === "error" && now.getTime() - Date.parse(session.lastActivityAt) <= STALE_AFTER_MS) ??
    sessions.find(
      (session) =>
        session.status === "done" &&
        session.conversationId !== acknowledgedConversationId &&
        now.getTime() - Date.parse(session.lastActivityAt) <= DONE_SIGNAL_MS,
    ) ??
    null;
  const fallbackActivityStatus = getGlyphStatus(displayView.status);
  const hasRecentUnscopedDone =
    !lastLiveEvent?.conversationId &&
    (lastLiveEvent?.type === "turn_complete" || lastLiveEvent?.type === "turn_stop") &&
    now.getTime() - Date.parse(lastLiveEvent.timestamp) <= DONE_SIGNAL_MS;
  const hasRecentFallbackError = fallbackActivityStatus === "error" && presence.lastEventAt !== null && now.getTime() - Date.parse(presence.lastEventAt) <= STALE_AFTER_MS;
  const activityStatus = activitySession?.status ?? (hasRecentUnscopedDone ? "done" : fallbackActivityStatus === "working" || fallbackActivityStatus === "attention" || hasRecentFallbackError ? fallbackActivityStatus : "idle");
  const activityKind: ActivityKind = activitySession?.activityKind ?? (activityStatus === "attention" ? "attention" : activityStatus === "done" ? "done" : displayView.status === "thinking" ? "thinking" : displayView.status === "error" ? "error" : "session");
  const activityViewStatus: IStatusView["status"] = (() => {
    if (activityStatus === "working") return "tool-running";
    if (activityStatus === "attention") return "attention";
    if (activityStatus === "inactive") return "stale";
    if (activityStatus === "done") return "closed";
    if (activityStatus === "error") return "error";
    return displayView.status;
  })();
  const glyphStatus = getGlyphStatus(activityViewStatus);
  const isWorkingActivity = activityStatus === "working";
  const hasWorkingActivity = shouldKeepDisplayAwakeForActivity(
    sessions,
    fallbackActivityStatus,
  );
  const hasLiveActivity = isWorkingActivity || activityStatus === "attention" || activityStatus === "done" || activityStatus === "error";

  useEffect(() => {
    if (!canUseNativeControls) {
      setKeepAwakeActive(false);
      setKeepAwakeError(null);
      return undefined;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const requestedActive = keepAwakeEnabled && hasWorkingActivity;
    const syncNativeState = (attempt: number) => {
      const request = keepAwakeRequestRef.current
        .catch(() => undefined)
        .then(() => invoke<boolean>("set_keep_awake", { active: requestedActive }))
        .then((active) => {
          if (active !== requestedActive) {
            throw new Error("Native keep-awake state did not match the requested state");
          }
          return active;
        });
      keepAwakeRequestRef.current = request;
      void request
        .then((active) => {
          if (cancelled) return;
          setKeepAwakeActive(active);
          setKeepAwakeError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          const retryDelay = KEEP_AWAKE_RETRY_DELAYS_MS[attempt];
          if (retryDelay !== undefined) {
            retryTimer = window.setTimeout(() => syncNativeState(attempt + 1), retryDelay);
            return;
          }
          setKeepAwakeActive(false);
          setKeepAwakeError(error instanceof Error ? error.message : String(error || "Keep awake unavailable"));
        });
    };
    setKeepAwakeError(null);
    syncNativeState(0);

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [canUseNativeControls, hasWorkingActivity, keepAwakeEnabled]);

  const pillDetail = (() => {
    if (activitySession?.status === "working") return activitySession.detail === "thinking" ? "Thinking" : activitySession.detail;
    if (activityStatus === "attention") return activitySession?.detail ?? (lastLiveEvent?.type === "attention_requested" && lastLiveEvent.data.kind === "question" ? "Question" : "Approval needed");
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

  useEffect(() => {
    const enterKeyboardMode = (event: KeyboardEvent) => {
      if (["Tab", "Enter", " ", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
        keyboardNavigationRef.current = true;
      }
    };
    const leaveKeyboardMode = () => {
      keyboardNavigationRef.current = false;
    };
    window.addEventListener("keydown", enterKeyboardMode, true);
    window.addEventListener("pointerdown", leaveKeyboardMode, true);
    return () => {
      window.removeEventListener("keydown", enterKeyboardMode, true);
      window.removeEventListener("pointerdown", leaveKeyboardMode, true);
    };
  }, []);

  useEffect(() => {
    if (!renderPanel || !panelOpen || !shouldFocusPanelRef.current) return;
    shouldFocusPanelRef.current = false;
    window.requestAnimationFrame(() => {
      const target = sheetInnerRef.current?.querySelector<HTMLElement>("[data-panel-focus-target]");
      target?.focus({ preventScroll: true });
    });
  }, [panelOpen, renderPanel, selectedSessionId, setupOpen]);

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

  const rememberFocusOrigin = () => {
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      returnFocusRef.current = document.activeElement;
    }
  };

  const restoreFocusOrigin = () => {
    window.requestAnimationFrame(() => {
      const target = returnFocusRef.current?.isConnected
        ? returnFocusRef.current
        : returnSessionIdRef.current
          ? surfaceRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(returnSessionIdRef.current)}"]`)
          : surfaceRef.current?.querySelector<HTMLElement>('.session-row-main, .header-tab[data-active="true"], .header-tab');
      target?.focus({ preventScroll: true });
      returnFocusRef.current = null;
      returnSessionIdRef.current = null;
    });
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
    if (keyboardNavigationRef.current && surfaceRef.current?.contains(document.activeElement)) return;
    if (hoverCloseTimerRef.current !== null) return;
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (keyboardNavigationRef.current && surfaceRef.current?.contains(document.activeElement)) return;
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
    rememberFocusOrigin();
    returnSessionIdRef.current = conversationId;
    shouldFocusPanelRef.current = true;
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    setSetupOpen(false);
    setActiveMainTab("sessions");
    setSessionAction({ ok: null, message: null });
    setSelectedSessionId(conversationId);
    setPanelOpen(true);
  };

  const openSetup = () => {
    rememberFocusOrigin();
    returnSessionIdRef.current = null;
    shouldFocusPanelRef.current = true;
    clearHoverOpenTimer();
    clearHoverCloseTimer();
    setSelectedSessionId(null);
    setSetupOpen(true);
    setPanelOpen(true);
  };

  const activateMainTab = (tab: MainPanelTab) => {
    setSetupOpen(false);
    setSelectedSessionId(null);
    setActiveMainTab(tab);
    setPanelOpen(true);
  };

  const handleMainTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, currentTab: MainPanelTab) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs: MainPanelTab[] = ["sessions", "usage"];
    const currentIndex = tabs.indexOf(currentTab);
    const nextTab = event.key === "Home"
      ? tabs[0]
      : event.key === "End"
        ? tabs.at(-1) ?? tabs[0]
        : tabs[(currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    activateMainTab(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`main-tab-${nextTab}`)?.focus());
  };

  const handleSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (!panelOpen) return;
      event.preventDefault();
      if (selectedSessionId || setupOpen) {
        backToSessions();
        return;
      }
      closePanel({ suppressHover: true });
      window.requestAnimationFrame(() => surfaceRef.current?.focus({ preventScroll: true }));
      return;
    }

    if (event.target !== event.currentTarget || panelOpen || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    shouldFocusPanelRef.current = true;
    setHoverExpandSuppressed(false);
    setPanelOpen(true);
  };

  const updateUsageSettings = (settings: IUsageSettings) => {
    setUsageSettings(settings);
    writeUsageSettings(settings);
  };

  const updateKeepAwakeEnabled = (enabled: boolean) => {
    setKeepAwakeEnabled(enabled);
    writeKeepAwakeEnabled(enabled);
  };

  const backToSessions = () => {
    setSelectedSessionId(null);
    setSetupOpen(false);
    setActiveMainTab("sessions");
    restoreFocusOrigin();
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

  const clearCompletedSessionGroup = (group: IWorkspaceSessionGroup) => {
    const completed = group.sessions.filter((session) => session.status === "done");
    if (completed.length === 0) return;
    const clearedAt = Date.now();
    setDismissedSessionIds((current) => {
      const next = { ...current };
      for (const session of completed) next[session.conversationId] = clearedAt;
      writeDismissedSessionIds(next);
      return next;
    });
    if (selectedSessionId && completed.some((session) => session.conversationId === selectedSessionId)) setSelectedSessionId(null);
  };

  const clearCompletedSessions = () => {
    if (!clearCompletedArmed) {
      setClearCompletedArmed(true);
      return;
    }

    const clearedAt = Date.now();
    setDismissedSessionIds((current) => {
      const next = { ...current };
      for (const session of completedSessions) next[session.conversationId] = clearedAt;
      writeDismissedSessionIds(next);
      return next;
    });
    setAcknowledgedConversationId(null);
    if (selectedSessionId && completedSessions.some((session) => session.conversationId === selectedSessionId)) setSelectedSessionId(null);
    setClearCompletedArmed(false);
  };

  const toggleSessionGroup = (groupKey: string) => {
    setExpandedSessionGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
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

  const requestRemoveSessionHistory = (conversationId: string) => {
    if (pendingRemoveHistoryId !== conversationId) {
      setPendingRemoveHistoryId(conversationId);
      return;
    }
    deleteSession(conversationId);
    setPendingRemoveHistoryId(null);
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
      const exactMatch = message.startsWith("Focused Ghostty ·");
      setSessionAction({ ok: exactMatch, message });
      if (exactMatch) closePanel({ suppressHover: true });
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
          onPointerMove={() => { keyboardNavigationRef.current = false; }}
          onClick={(event) => {
            if (event.target !== event.currentTarget || panelOpen) return;
            setPanelOpen(true);
          }}
          onKeyDown={handleSurfaceKeyDown}
          role={renderPanel ? "region" : "button"}
          aria-label={renderPanel ? "Agent Halo panel" : "Open Agent Halo"}
          aria-expanded={panelOpen}
          tabIndex={renderPanel ? -1 : 0}
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
              {hasLiveActivity ? <ActivityMascot activityKind={activityKind} identityKey={activitySession?.workspacePath ?? presence.cwd} sessionId={activitySession?.conversationId ?? presence.conversationId} status={activityStatus} /> : null}
            </div>
          </div>

          {renderPanel ? <div className="sheet-inner" ref={sheetInnerRef}>
            {setupOpen ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <button className="gear-btn" type="button" onClick={backToSessions} data-panel-focus-target data-tauri-drag-region="false" title="Back to sessions">
                  <ChevronLeft size={14} strokeWidth={2.3} />
                </button>
                <span className="status-slot"><Settings className="setup-icon" size={14} strokeWidth={2.3} /></span>
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
              </div>
            ) : selectedSession ? (
              <div className="sheet-header detail-header" data-tauri-drag-region="false">
                <StatusGlyph status={selectedSession.status} />
                <span className="header-title">{headerLabel}</span>
                <span className="spacer" />
              </div>
            ) : (
              <div className="sheet-header" data-tauri-drag-region="false">
                <StatusGlyph status={glyphStatus} />
                <span className="header-title">{headerLabel}</span>
                {DEMO_MODE ? <span className="agent-badge">DEMO</span> : null}
                <span className="spacer" />
                <span className="bridge-dot" data-connected={isConnected} title={connectionTitle} />
                <div className="header-tabs">
                  <div className="header-tablist" role="tablist" aria-label="Agent Halo sections">
                    <button id="main-tab-sessions" className="header-tab" data-active={activeMainTab === "sessions"} data-panel-focus-target={activeMainTab === "sessions" ? "true" : undefined} type="button" role="tab" aria-label="Sessions" aria-selected={activeMainTab === "sessions"} aria-controls="main-panel-sessions" tabIndex={activeMainTab === "sessions" ? 0 : -1} onKeyDown={(event) => handleMainTabKeyDown(event, "sessions")} onClick={(event) => { event.stopPropagation(); activateMainTab("sessions"); }} data-tauri-drag-region="false" title="Sessions">
                      <List size={13} strokeWidth={2.3} />
                    </button>
                    <button id="main-tab-usage" className="header-tab" data-active={activeMainTab === "usage"} data-panel-focus-target={activeMainTab === "usage" ? "true" : undefined} type="button" role="tab" aria-label="Usage" aria-selected={activeMainTab === "usage"} aria-controls="main-panel-usage" tabIndex={activeMainTab === "usage" ? 0 : -1} onKeyDown={(event) => handleMainTabKeyDown(event, "usage")} onClick={(event) => { event.stopPropagation(); activateMainTab("usage"); }} data-tauri-drag-region="false" title="Usage">
                      <BarChart3 size={13} strokeWidth={2.3} />
                    </button>
                  </div>
                  <button className="header-tab" type="button" aria-label="Setup" onClick={(event) => { event.stopPropagation(); openSetup(); }} data-tauri-drag-region="false" title="Setup">
                    <Settings size={13} strokeWidth={2.3} />
                  </button>
                </div>
              </div>
            )}
            <div className="sheet-divider" />

            <div
              className="sheet-body"
              data-view={activeMainTab === "usage" && !setupOpen && !selectedSession ? "usage" : "default"}
              id={!setupOpen && !selectedSession ? `main-panel-${activeMainTab}` : undefined}
              role={!setupOpen && !selectedSession ? "tabpanel" : undefined}
              aria-labelledby={!setupOpen && !selectedSession ? `main-tab-${activeMainTab}` : undefined}
            >
              {setupOpen ? (
                <SetupPanel
                  capabilities={capabilities}
                  canUseNativeControls={canUseNativeControls}
                  connectionTitle={connectionTitle}
                  guidance={setupGuidance}
                  isConnected={isConnected}
                  keepAwakeActive={keepAwakeActive}
                  keepAwakeEnabled={keepAwakeEnabled}
                  keepAwakeError={keepAwakeError}
                  modStatus={modStatus}
                  nativeAction={nativeAction}
                  onCheckBridge={() => void checkBridge()}
                  onInstallMod={() => void installMod()}
                  onKeepAwakeChange={updateKeepAwakeEnabled}
                />
              ) : selectedSession ? (
                <div className="detail-body session-context-view" data-status={selectedSession.status}>
                  <SessionContextSummary session={selectedSession} />
                  <div className="detail-path" title={selectedSession.cwd}>{shortenPath(selectedSession.cwd)}</div>
                  {canUseNativeControls ? (
                    <div className="capability-note">Focus matches Ghostty terminal cwd/title and selects its tab</div>
                  ) : (
                    <div className="capability-note">Focus needs the desktop runtime</div>
                  )}
                  {sessionAction.message ? (
                    <div className="notice-row compact" data-online={sessionAction.ok === true} role="status" aria-live="polite">{sessionAction.message}</div>
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
                            <span className="action-mark" aria-hidden="true" />
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
                  {sessionAction.message ? (
                    <div className="notice-row compact session-focus-notice" data-online={sessionAction.ok === true} role="status" aria-live="polite">{sessionAction.message}</div>
                  ) : null}
                  <div className="session-sections">
                    {activeSessionGroups.length > 0 ? (
                      <section className="session-section" aria-labelledby="active-session-heading">
                        <div className="session-section-head">
                          <span id="active-session-heading">Active</span>
                          <span className="session-section-count">{activeSessionGroups.reduce((count, group) => count + group.sessions.length, 0)}</span>
                        </div>
                        <ul className="session-list">
                          {activeSessionGroups.map((group) => {
                            const groupKey = `active:${group.key}`;
                            return (
                              <WorkspaceSessionGroupItem
                                expanded={expandedSessionGroupKeys.has(groupKey)}
                                group={group}
                                groupKey={groupKey}
                                onClear={dismissSession}
                                onClearGroup={clearCompletedSessionGroup}
                                onFocus={(session) => void focusSelectedSession(session)}
                                onOpen={openSession}
                                onToggle={toggleSessionGroup}
                                key={groupKey}
                              />
                            );
                          })}
                        </ul>
                      </section>
                    ) : null}
                    {completedSessionGroups.length > 0 ? (
                      <section className="session-section completed-section" aria-labelledby="completed-session-heading">
                        <div className="session-section-head">
                          <span id="completed-session-heading">Completed</span>
                          <span className="session-section-count">{completedSessions.length}</span>
                          <span className="spacer" />
                          <button
                            className="session-section-action"
                            data-armed={clearCompletedArmed}
                            type="button"
                            onClick={clearCompletedSessions}
                            data-tauri-drag-region="false"
                          >
                            {clearCompletedArmed ? `Confirm clear ${completedSessions.length}` : "Clear completed"}
                          </button>
                        </div>
                        <ul className="session-list">
                          {completedSessionGroups.map((group) => {
                            const groupKey = `completed:${group.key}`;
                            return (
                              <WorkspaceSessionGroupItem
                                expanded={expandedSessionGroupKeys.has(groupKey)}
                                group={group}
                                groupKey={groupKey}
                                onClear={dismissSession}
                                onClearGroup={clearCompletedSessionGroup}
                                onFocus={(session) => void focusSelectedSession(session)}
                                onOpen={openSession}
                                onToggle={toggleSessionGroup}
                                key={groupKey}
                              />
                            );
                          })}
                        </ul>
                      </section>
                    ) : null}
                  </div>

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
              <div className={`sheet-footer ${selectedSession ? "session-context-footer" : ""}`}>
                {selectedSession ? (
                  <>
                    <div className="session-context-actions">
                    <button className="pill-btn accent" type="button" onClick={() => void focusSelectedSession(selectedSession)} data-tauri-drag-region="false">
                      <Focus size={12} strokeWidth={2.3} />
                      Focus
                    </button>
                    {selectedSession.status === "done" ? (
                      <button className="pill-btn" type="button" onClick={() => dismissSession(selectedSession.conversationId)} data-tauri-drag-region="false" title="Hide until fresh activity arrives">
                        <X size={12} strokeWidth={2.4} />
                        Clear
                      </button>
                    ) : null}
                    <button
                      className={`pill-btn danger session-history-action ${pendingRemoveHistoryId === selectedSession.conversationId ? "is-armed" : ""}`}
                      type="button"
                      onClick={() => requestRemoveSessionHistory(selectedSession.conversationId)}
                      data-tauri-drag-region="false"
                      title="Remove this session's locally stored activity"
                      aria-label={pendingRemoveHistoryId === selectedSession.conversationId ? "Confirm remove" : "Remove history"}
                    >
                      <Trash2 size={12} strokeWidth={2.3} />
                      {pendingRemoveHistoryId === selectedSession.conversationId ? "Confirm remove" : null}
                    </button>
                    </div>
                    <button
                      className="session-context-return"
                      type="button"
                      onClick={backToSessions}
                      data-tauri-drag-region="false"
                      aria-label={`Back to all ${sessions.length} ${sessions.length === 1 ? "session" : "sessions"}`}
                    >
                      <ChevronLeft size={12} strokeWidth={2.3} />
                      <span>Back to sessions</span>
                      <span className="session-context-return-count">{sessions.length}</span>
                    </button>
                  </>
                ) : (
                  <>
                    <span className="footer-meta">{workspace} · {model}</span>
                    <span className="spacer" />
                    {setupOpen ? (
                      <div className="footer-actions">
                        <button className="pill-btn" type="button" onClick={backToSessions} data-tauri-drag-region="false">
                          <List size={12} strokeWidth={2.3} />
                          Sessions
                        </button>
                      </div>
                    ) : null}
                    {!setupOpen && activitySession?.status === "done" ? (
                      <button className="pill-btn accent" type="button" onClick={(event) => { event.stopPropagation(); acknowledgeDone(); }} data-tauri-drag-region="false">
                        <Check size={12} strokeWidth={2.4} />
                        Close
                      </button>
                    ) : null}
                  </>
                )}
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
