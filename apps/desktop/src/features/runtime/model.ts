import type { IAgentHaloEventRuntime } from "@agent-halo/protocol";
import type { ISessionSummary } from "../session/types";
import type { ILocalService, ILocalServiceOwnerTarget, IRuntimeSessionView, IRuntimeTargetSource, IRuntimeUsageSnapshot, IRuntimeUsageTarget, RuntimePressureLevel } from "./types";

const GIB = 1024 ** 3;
const RECENT_SHARED_PROCESS_MS = 10 * 60_000;
export const RUNTIME_NATIVE_TARGET_LIMIT = 64;
export const RUNTIME_HISTORY_TARGET_LIMIT = 512;
export const LOCAL_SERVICE_OWNER_TARGET_LIMIT = 512;

export const runtimeTargetKey = (target: Pick<IRuntimeUsageTarget, "conversationId" | "processId" | "sourceStartedAtMs">): string =>
  `${target.processId}:${target.sourceStartedAtMs}:${target.conversationId}`;

export const isTerminalRuntimeStatus = (status: IRuntimeUsageSnapshot["status"]): boolean => status === "missing" || status === "pidReused";

const PRESSURE_PRIORITY: Record<RuntimePressureLevel, number> = {
  unavailable: -1,
  normal: 0,
  elevated: 1,
  high: 2,
  critical: 3,
};

const isHostRuntime = (runtime: IAgentHaloEventRuntime | null | undefined): runtime is IAgentHaloEventRuntime =>
  runtime?.sourceKind === "lettaHost" && Number.isInteger(runtime.sourcePid) && runtime.sourcePid > 1 && Number.isFinite(runtime.sourceStartedAtMs);

const buildRuntimeTarget = (
  session: ISessionSummary,
  registry: IRuntimeTargetSource["registry"],
): IRuntimeUsageTarget | null => {
  const runtimeEvent = (registry[session.conversationId] ?? []).find((event) => isHostRuntime(event.runtime));
  if (!runtimeEvent?.runtime || !isHostRuntime(runtimeEvent.runtime)) return null;
  const cwd = session.workspacePath ?? runtimeEvent.cwd ?? null;
  if (!cwd) return null;
  return {
    conversationId: session.conversationId,
    runtimeEventId: runtimeEvent.id,
    processId: runtimeEvent.runtime.sourcePid,
    sourceStartedAtMs: runtimeEvent.runtime.sourceStartedAtMs,
    cwd,
    project: session.project,
    workspace: session.workspace,
    herdrPaneId: session.herdrTarget?.sourcePid === runtimeEvent.runtime.sourcePid &&
      Math.abs(session.herdrTarget.sourceStartedAtMs - runtimeEvent.runtime.sourceStartedAtMs) <= 2_000
      ? session.herdrTarget.paneId
      : null,
    sessionStatus: session.status,
    lastActivityAt: session.lastActivityAt,
    relatedConversationCount: 1,
    mappingStatus: "exact",
  };
};

export const buildRuntimeUsageTargets = ({ sessions, registry }: IRuntimeTargetSource): IRuntimeUsageTarget[] => {
  const byProcessIdentity = new Map<string, IRuntimeUsageTarget[]>();

  for (const session of sessions) {
    const target = buildRuntimeTarget(session, registry);
    if (!target) continue;
    const processIdentity = `${target.processId}:${target.sourceStartedAtMs}`;
    const group = byProcessIdentity.get(processIdentity) ?? [];
    group.push(target);
    byProcessIdentity.set(processIdentity, group);
  }

  return [...byProcessIdentity.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
      const newest = sorted[0];
      const newestAt = Date.parse(newest.lastActivityAt);
      const recentLive = sorted.filter(
        (target) =>
          ["working", "attention"].includes(target.sessionStatus) &&
          newestAt - Date.parse(target.lastActivityAt) <= RECENT_SHARED_PROCESS_MS,
      );
      return {
        ...newest,
        relatedConversationCount: sorted.length,
        mappingStatus: recentLive.length > 1 ? "sharedProcess" as const : "exact" as const,
      };
    })
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .slice(0, RUNTIME_HISTORY_TARGET_LIMIT);
};

export const buildRuntimeLivenessTargets = ({ sessions, registry }: IRuntimeTargetSource): IRuntimeUsageTarget[] =>
  sessions
    .filter((session) => ["working", "attention"].includes(session.status))
    .map((session) => buildRuntimeTarget(session, registry))
    .filter((target): target is IRuntimeUsageTarget => target !== null)
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));

export const buildLocalServiceOwnerTargets = ({ sessions, registry }: IRuntimeTargetSource): ILocalServiceOwnerTarget[] => {
  const byProcessIdentity = new Map<string, { target: ILocalServiceOwnerTarget; lastActivityAt: string }>();
  for (const session of sessions) {
    const runtimeEvent = (registry[session.conversationId] ?? []).find((event) => isHostRuntime(event.runtime));
    if (!runtimeEvent?.runtime || !isHostRuntime(runtimeEvent.runtime)) continue;
    const target: ILocalServiceOwnerTarget = {
      conversationId: session.conversationId,
      processId: runtimeEvent.runtime.sourcePid,
      expectedStartTimeMs: runtimeEvent.runtime.sourceStartedAtMs,
      project: session.project,
      herdrPaneId: session.herdrTarget?.sourcePid === runtimeEvent.runtime.sourcePid &&
        Math.abs(session.herdrTarget.sourceStartedAtMs - runtimeEvent.runtime.sourceStartedAtMs) <= 2_000
        ? session.herdrTarget.paneId
        : null,
    };
    const key = `${target.processId}:${target.expectedStartTimeMs}`;
    const previous = byProcessIdentity.get(key);
    if (!previous || Date.parse(session.lastActivityAt) > Date.parse(previous.lastActivityAt)) {
      byProcessIdentity.set(key, { target, lastActivityAt: session.lastActivityAt });
    }
  }
  return [...byProcessIdentity.values()]
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt))
    .slice(0, LOCAL_SERVICE_OWNER_TARGET_LIMIT)
    .map(({ target }) => target);
};

export const selectRuntimeSamplingTargets = (targets: IRuntimeUsageTarget[], endedIdentities: ReadonlyMap<string, number>): IRuntimeUsageTarget[] =>
  targets.filter((target) => !endedIdentities.has(runtimeTargetKey(target))).slice(0, RUNTIME_NATIVE_TARGET_LIMIT);

export const selectRuntimeMonitorTargets = (
  runtimeTargets: IRuntimeUsageTarget[],
  livenessTargets: IRuntimeUsageTarget[],
  processActive: boolean,
  livenessActive: boolean,
): IRuntimeUsageTarget[] => {
  const candidates = processActive
    ? [...livenessTargets, ...runtimeTargets]
    : livenessActive
      ? livenessTargets
      : [];
  const byIdentity = new Map(candidates.map((target) => [runtimeTargetKey(target), target]));
  return [...byIdentity.values()].slice(0, RUNTIME_NATIVE_TARGET_LIMIT);
};

export const reconcileEndedRuntimeSessions = (
  sessions: ISessionSummary[],
  endedConversationIds: ReadonlySet<string>,
): ISessionSummary[] => sessions.map((session) =>
  endedConversationIds.has(session.conversationId) && ["working", "attention"].includes(session.status)
    ? { ...session, status: "inactive" }
    : session,
);

export const classifyRuntimePressure = (
  snapshot: IRuntimeUsageSnapshot | null,
  sessionStatus: IRuntimeUsageTarget["sessionStatus"],
): Pick<IRuntimeSessionView, "pressure" | "pressureReason"> => {
  if (!snapshot || snapshot.status !== "ok" || !snapshot.host || !snapshot.children) {
    return {
      pressure: "unavailable",
      pressureReason: snapshot?.error ?? "Waiting for a native runtime sample",
    };
  }

  const host = snapshot.host.physicalFootprintBytes;
  const children = snapshot.children.physicalFootprintBytes;
  const childCpu = snapshot.children.cpuPercent ?? 0;
  const quiet = ["idle", "inactive", "done"].includes(sessionStatus);

  if (host >= 3 * GIB) return { pressure: "critical", pressureReason: "Letta host above 3 GiB" };
  if (children >= 3 * GIB || childCpu >= 250) return { pressure: "critical", pressureReason: "Child workload is using several cores or over 3 GiB" };
  if (host >= 1.5 * GIB) return { pressure: "high", pressureReason: quiet ? "High memory while quiet" : "Letta host above 1.5 GiB" };
  if (children >= 1.5 * GIB || childCpu >= 150 || snapshot.children.processCount >= 20) {
    return { pressure: "high", pressureReason: "Heavy descendant workload" };
  }
  if (host >= 1.2 * GIB || children >= 768 * 1024 ** 2 || childCpu >= 80 || snapshot.children.processCount >= 10) {
    return { pressure: "elevated", pressureReason: "Resource use is above the quiet baseline" };
  }
  return { pressure: "normal", pressureReason: "Within the observed local baseline" };
};

export const buildRuntimeSessionViews = (
  targets: IRuntimeUsageTarget[],
  snapshots: IRuntimeUsageSnapshot[],
): IRuntimeSessionView[] => {
  const byTarget = new Map(snapshots.map((snapshot) => [`${snapshot.processId}:${snapshot.conversationId}`, snapshot]));
  return targets
    .map((target) => {
      const candidate = byTarget.get(`${target.processId}:${target.conversationId}`) ?? null;
      const snapshot = candidate?.targetSourceStartedAtMs === target.sourceStartedAtMs &&
        (candidate.processStartTimeMs == null || Math.abs(candidate.processStartTimeMs - target.sourceStartedAtMs) <= 2_000)
        ? candidate
        : null;
      return { ...target, snapshot, ...classifyRuntimePressure(snapshot, target.sessionStatus) };
    })
    .sort(
      (a, b) =>
        PRESSURE_PRIORITY[b.pressure] - PRESSURE_PRIORITY[a.pressure] ||
        (b.snapshot?.host?.physicalFootprintBytes ?? 0) - (a.snapshot?.host?.physicalFootprintBytes ?? 0),
    );
};

export const formatRuntimeBytes = (bytes: number | null | undefined): string => {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes >= GIB) return `${(bytes / GIB).toFixed(bytes >= 10 * GIB ? 0 : 1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
};

export const formatRuntimeCpu = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`;

export const formatLocalServiceEndpoint = (service: Pick<ILocalService, "bindAddress" | "port">): string => {
  const host = service.bindAddress.includes(":") && !service.bindAddress.startsWith("[")
    ? `[${service.bindAddress}]`
    : service.bindAddress;
  return `${host}:${service.port}`;
};

export const localServiceProcessKey = (service: Pick<ILocalService, "processId" | "processStartTimeMs">): string =>
  `${service.processId}:${service.processStartTimeMs ?? "unknown"}`;

export const localServiceListenerKey = (service: Pick<ILocalService, "processId" | "processStartTimeMs" | "bindAddress" | "port">): string =>
  `${localServiceProcessKey(service)}:${service.bindAddress}:${service.port}`;

export const formatLocalServiceUptime = (startedAtMs: number | null, nowMs = Date.now()): string => {
  if (startedAtMs == null || !Number.isFinite(startedAtMs) || startedAtMs <= 0 || startedAtMs > nowMs) return "—";
  const minutes = Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

const DEMO_SERVICES_BASE_STARTED_AT_MS = Date.now();

export const createDemoLocalServices = (): ILocalService[] => [
  {
    processId: 40_680,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 32 * 60_000,
    processName: "node",
    parentProcessId: 40_600,
    parentProcessName: "letta",
    executablePath: "/opt/homebrew/bin/node",
    userId: 501,
    physicalFootprintBytes: 184 * 1024 ** 2,
    residentSizeBytes: 126 * 1024 ** 2,
    bindAddress: "127.0.0.1",
    port: 5173,
    kind: "http",
    webFrontend: true,
    httpTitle: "Haabiz UI",
    url: "http://127.0.0.1:5173",
    cwd: "/Users/mahiro/ghq/github.com/haabiz/admin-template/apps/catalog",
    owner: { conversationId: "local-conv-haabiz", project: "admin-template", herdrPaneId: "wH:p1" },
    controlAvailable: true,
    controlUnavailableReason: null,
  },
  {
    processId: 40_681,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 18 * 60_000,
    processName: "bun",
    parentProcessId: 40_610,
    parentProcessName: "letta",
    executablePath: "/Users/mahiro/.bun/bin/bun",
    userId: 501,
    physicalFootprintBytes: 152 * 1024 ** 2,
    residentSizeBytes: 104 * 1024 ** 2,
    bindAddress: "127.0.0.1",
    port: 4173,
    kind: "http",
    webFrontend: true,
    httpTitle: "MORROW — ONE",
    url: "http://127.0.0.1:4173",
    cwd: "/Users/mahiro/ghq/github.com/mahirocoko/building-frontends-pilot-morrow-one",
    owner: { conversationId: "local-conv-mahirocoko", project: "mahirocoko", herdrPaneId: "wB:pH" },
    controlAvailable: true,
    controlUnavailableReason: null,
  },
  {
    processId: 16_584,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 3 * 60 * 60_000,
    processName: "bun",
    parentProcessId: 16_500,
    parentProcessName: "Agent Halo",
    executablePath: "/Users/mahiro/.bun/bin/bun",
    userId: 501,
    physicalFootprintBytes: 42 * 1024 ** 2,
    residentSizeBytes: 31 * 1024 ** 2,
    bindAddress: "127.0.0.1",
    port: 47_621,
    kind: "http",
    webFrontend: false,
    httpTitle: null,
    url: "http://127.0.0.1:47621",
    cwd: "/Users/mahiro/ghq/github.com/mahirocoko/agent-halo",
    owner: { conversationId: "local-conv-agent-halo", project: "agent-halo", herdrPaneId: "wV:p1" },
    controlAvailable: false,
    controlUnavailableReason: "Agent Halo bridge is protected",
  },
  {
    processId: 16_590,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 9 * 60_000,
    processName: "Python",
    parentProcessId: 16_500,
    parentProcessName: "letta",
    executablePath: "/usr/bin/python3",
    userId: 501,
    physicalFootprintBytes: 28 * 1024 ** 2,
    residentSizeBytes: 20 * 1024 ** 2,
    bindAddress: "127.0.0.1",
    port: 8000,
    kind: "http",
    webFrontend: false,
    httpTitle: "Directory listing for /",
    url: "http://127.0.0.1:8000",
    cwd: "/Users/mahiro/ghq/github.com/mahirocoko/building-frontends-pilot-morrow-one",
    owner: { conversationId: "local-conv-mahirocoko", project: "mahirocoko", herdrPaneId: "wB:pH" },
    controlAvailable: true,
    controlUnavailableReason: null,
  },
  {
    processId: 1_637,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 2 * 24 * 60 * 60_000,
    processName: "redis-server",
    parentProcessId: 1,
    parentProcessName: "launchd",
    executablePath: "/opt/homebrew/bin/redis-server",
    userId: 501,
    physicalFootprintBytes: 19 * 1024 ** 2,
    residentSizeBytes: 12 * 1024 ** 2,
    bindAddress: "127.0.0.1",
    port: 6379,
    kind: "tcp",
    webFrontend: false,
    httpTitle: null,
    url: null,
    cwd: null,
    owner: null,
    controlAvailable: true,
    controlUnavailableReason: null,
  },
  {
    processId: 1_645,
    processStartTimeMs: DEMO_SERVICES_BASE_STARTED_AT_MS - 4 * 24 * 60 * 60_000,
    processName: "postgres",
    parentProcessId: 1,
    parentProcessName: "launchd",
    executablePath: "/opt/homebrew/bin/postgres",
    userId: 501,
    physicalFootprintBytes: 65 * 1024 ** 2,
    residentSizeBytes: 52 * 1024 ** 2,
    bindAddress: "::1",
    port: 5432,
    kind: "tcp",
    webFrontend: false,
    httpTitle: null,
    url: null,
    cwd: null,
    owner: null,
    controlAvailable: true,
    controlUnavailableReason: null,
  },
];

export const createDemoRuntimeSnapshots = (targets: IRuntimeUsageTarget[]): IRuntimeUsageSnapshot[] =>
  targets.map((target, index) => {
    const critical = index === 0;
    const toolsHeavy = index === 1;
    if (target.project === "paoplew") {
      return {
        conversationId: target.conversationId,
        processId: target.processId,
        processStartTimeMs: null,
        cwd: target.cwd,
        sampledAtMs: Date.now(),
        status: "missing",
        error: "Letta process is no longer available",
        host: null,
        children: null,
      };
    }
    if (target.conversationId.includes("done-b")) {
      return {
        conversationId: target.conversationId,
        processId: target.processId,
        processStartTimeMs: target.sourceStartedAtMs,
        cwd: target.cwd,
        sampledAtMs: Date.now(),
        status: "identityMismatch",
        error: "PID now belongs to a different working directory",
        host: null,
        children: null,
      };
    }
    return {
      conversationId: target.conversationId,
      processId: target.processId,
      processStartTimeMs: target.sourceStartedAtMs,
      cwd: target.cwd,
      sampledAtMs: Date.now(),
      status: "ok",
      error: null,
      host: {
        physicalFootprintBytes: critical ? 3.4 * GIB : 860 * 1024 ** 2,
        residentSizeBytes: critical ? 1.2 * GIB : 620 * 1024 ** 2,
        cpuPercent: critical ? 18 : 4,
      },
      children: {
        processCount: toolsHeavy ? 28 : 3,
        physicalFootprintBytes: toolsHeavy ? 3.1 * GIB : 180 * 1024 ** 2,
        residentSizeBytes: toolsHeavy ? 2.6 * GIB : 140 * 1024 ** 2,
        cpuPercent: toolsHeavy ? 286 : 2,
        topProcesses: [],
      },
    };
  });
