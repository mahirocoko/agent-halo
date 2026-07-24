import type { AgentHaloEvent, IAgentHaloPresence } from "@agent-halo/protocol";
import {
  getEventActivity,
  getEventSessionStatus,
  projectName,
  shortenPath,
} from "./activity";
import type {
  ISessionDetail,
  ISessionSummary,
  IWorkspaceSessionGroup,
  SessionEventRegistry,
} from "./types";

const SESSION_STATUS_PRIORITY: Record<ISessionSummary["status"], number> = {
  attention: 6,
  error: 5,
  working: 4,
  done: 3,
  idle: 2,
  inactive: 1,
};

const compareActivity = (a: ISessionSummary, b: ISessionSummary) =>
  Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);

export const shouldKeepDisplayAwakeForActivity = (
  sessions: Pick<ISessionSummary, "status">[],
  fallbackStatus: ISessionSummary["status"],
) =>
  fallbackStatus === "working" ||
  sessions.some((session) => session.status === "working");

const isInternalWorkspacePath = (path: string | null | undefined) =>
  Boolean(
    path &&
      (path.includes("/.letta/lc-local-backend/memfs/") ||
        path.includes("/.letta/mod-cache/") ||
        path.endsWith("/.letta/mods") ||
        path.endsWith("/memory")),
  );

const getSessionWorkspacePath = (
  events: AgentHaloEvent[],
  fallback?: string | null,
): string | null =>
  events.find((event) => event.cwd && !isInternalWorkspacePath(event.cwd))?.cwd ??
  (fallback && !isInternalWorkspacePath(fallback) ? fallback : null);

const isInternalOnlySession = (events: AgentHaloEvent[]) =>
  events.length > 0 &&
  events.every((event) => !event.cwd || isInternalWorkspacePath(event.cwd));

const getSessionHerdrTarget = (events: AgentHaloEvent[]) =>
  events.find(
    (event) =>
      typeof event.runtime?.herdr?.socketPath === "string" &&
      event.runtime.herdr.socketPath.length > 0 &&
      typeof event.runtime.herdr.paneId === "string" &&
      event.runtime.herdr.paneId.length > 0 &&
      Number.isInteger(event.runtime.herdr.sourcePid) &&
      Number.isFinite(event.runtime.herdr.sourceStartedAtMs),
  )?.runtime?.herdr ?? null;

export const buildWorkspaceSessionGroups = (
  sessions: ISessionSummary[],
): IWorkspaceSessionGroup[] => {
  const grouped = new Map<string, ISessionSummary[]>();
  for (const session of sessions) {
    const key = session.workspacePath
      ? `cwd:${session.workspacePath}`
      : `session:${session.conversationId}`;
    const group = grouped.get(key);
    if (group) group.push(session);
    else grouped.set(key, [session]);
  }

  return [...grouped.entries()]
    .map(([key, groupSessions]) => {
      let primarySession = groupSessions[0];
      let latestSession = groupSessions[0];
      let activeCount = 0;
      let doneCount = 0;

      for (const session of groupSessions) {
        const sessionPriority = SESSION_STATUS_PRIORITY[session.status];
        const primaryPriority = SESSION_STATUS_PRIORITY[primarySession.status];
        if (
          sessionPriority > primaryPriority ||
          (sessionPriority === primaryPriority && compareActivity(session, primarySession) < 0)
        ) {
          primarySession = session;
        }
        if (compareActivity(session, latestSession) < 0) latestSession = session;
        if (session.status === "working" || session.status === "attention") activeCount += 1;
        if (session.status === "done") doneCount += 1;
      }

      return {
        key,
        project: primarySession.project,
        workspace: primarySession.workspace,
        workspacePath: primarySession.workspacePath,
        status: primarySession.status,
        activityKind: primarySession.activityKind,
        detail:
          activeCount > 0
            ? `${activeCount} active · ${groupSessions.length} sessions`
            : doneCount === groupSessions.length
              ? `${doneCount} done sessions`
              : `${groupSessions.length} sessions`,
        lastActivityAt: latestSession.lastActivityAt,
        primarySession,
        sessions: [...groupSessions].sort(compareActivity),
      };
    })
    .sort(
      (a, b) =>
        SESSION_STATUS_PRIORITY[b.status] - SESSION_STATUS_PRIORITY[a.status] ||
        Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    );
};

export const buildSessionSummaries = (
  registry: SessionEventRegistry,
  presence: IAgentHaloPresence,
  now: Date,
): ISessionSummary[] => {
  const sessions = new Map<string, ISessionSummary>();

  for (const [conversationId, sessionEvents] of Object.entries(registry)) {
    if (conversationId === "default" && isInternalOnlySession(sessionEvents)) continue;
    const latest = sessionEvents[0];
    if (!latest) continue;

    const activity = getEventActivity(latest);
    const workspacePath = getSessionWorkspacePath(sessionEvents, latest.cwd);
    sessions.set(conversationId, {
      conversationId,
      project: projectName(workspacePath ?? latest.cwd),
      workspace: shortenPath(workspacePath ?? latest.cwd),
      workspacePath,
      detail: activity.detail,
      activityKind: activity.kind,
      model: sessionEvents.find((event) => event.model)?.model ?? "Letta",
      status: getEventSessionStatus(latest, now),
      lastActivityAt: latest.timestamp,
      herdrTarget: getSessionHerdrTarget(sessionEvents),
    });
  }

  if (presence.conversationId && !sessions.has(presence.conversationId)) {
    const eventsForSession = registry[presence.conversationId] ?? [];
    const current = eventsForSession[0]
      ? ({ ...eventsForSession[0], cwd: presence.cwd } as AgentHaloEvent)
      : null;
    const workspacePath = getSessionWorkspacePath(
      current ? [current, ...eventsForSession] : eventsForSession,
      presence.cwd,
    );
    sessions.set(presence.conversationId, {
      conversationId: presence.conversationId,
      project: projectName(workspacePath ?? presence.cwd),
      workspace: shortenPath(workspacePath ?? presence.cwd),
      workspacePath,
      detail: "idle",
      activityKind: "session",
      model: presence.model ?? "Letta",
      status: "idle",
      lastActivityAt: presence.lastEventAt ?? new Date(0).toISOString(),
      herdrTarget: getSessionHerdrTarget(eventsForSession),
    });
  }

  return [...sessions.values()];
};

export const buildSessionDetail = (
  conversationId: string | null,
  sessions: ISessionSummary[],
  registry: SessionEventRegistry,
  presence: IAgentHaloPresence,
): ISessionDetail | null => {
  if (!conversationId) return null;
  const summary = sessions.find((session) => session.conversationId === conversationId);
  if (!summary) return null;

  const sessionEvents = registry[conversationId] ?? [];
  const latest = sessionEvents[0];
  const current = presence.conversationId === conversationId;
  const workspacePath =
    summary.workspacePath ?? getSessionWorkspacePath(sessionEvents, latest?.cwd);

  return {
    ...summary,
    agentName: (current ? presence.agentName : latest?.agentName) ?? "Mahiro Code",
    cwd: workspacePath ?? (current ? presence.cwd : latest?.cwd) ?? "No workspace",
    model: (current ? presence.model : latest?.model) ?? "Letta Code",
    permissionMode: (current ? presence.permissionMode : latest?.permissionMode) ?? "—",
    events: sessionEvents,
  };
};
