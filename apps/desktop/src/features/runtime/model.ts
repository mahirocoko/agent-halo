import type { IAgentHaloEventRuntime } from "@agent-halo/protocol";
import type { IRuntimeSessionView, IRuntimeTargetSource, IRuntimeUsageSnapshot, IRuntimeUsageTarget, RuntimePressureLevel } from "./types";

const GIB = 1024 ** 3;
const RECENT_SHARED_PROCESS_MS = 10 * 60_000;

const PRESSURE_PRIORITY: Record<RuntimePressureLevel, number> = {
  unavailable: -1,
  normal: 0,
  elevated: 1,
  high: 2,
  critical: 3,
};

const isHostRuntime = (runtime: IAgentHaloEventRuntime | null | undefined): runtime is IAgentHaloEventRuntime =>
  runtime?.sourceKind === "lettaHost" && Number.isInteger(runtime.sourcePid) && runtime.sourcePid > 1 && Number.isFinite(runtime.sourceStartedAtMs);

export const buildRuntimeUsageTargets = ({ sessions, registry }: IRuntimeTargetSource): IRuntimeUsageTarget[] => {
  const byPid = new Map<number, IRuntimeUsageTarget[]>();

  for (const session of sessions) {
    const runtimeEvent = (registry[session.conversationId] ?? []).find((event) => isHostRuntime(event.runtime));
    if (!runtimeEvent?.runtime || !isHostRuntime(runtimeEvent.runtime)) continue;
    const cwd = session.workspacePath ?? runtimeEvent.cwd ?? null;
    if (!cwd) continue;
    const target: IRuntimeUsageTarget = {
      conversationId: session.conversationId,
      runtimeEventId: runtimeEvent.id,
      processId: runtimeEvent.runtime.sourcePid,
      sourceStartedAtMs: runtimeEvent.runtime.sourceStartedAtMs,
      cwd,
      project: session.project,
      workspace: session.workspace,
      sessionStatus: session.status,
      lastActivityAt: session.lastActivityAt,
      relatedConversationCount: 1,
      mappingStatus: "exact",
    };
    const group = byPid.get(target.processId) ?? [];
    group.push(target);
    byPid.set(target.processId, group);
  }

  return [...byPid.values()]
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
    .sort((a, b) => Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt));
};

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
  const byConversation = new Map(snapshots.map((snapshot) => [snapshot.conversationId, snapshot]));
  return targets
    .map((target) => {
      const snapshot = byConversation.get(target.conversationId) ?? null;
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

export const createDemoRuntimeSnapshots = (targets: IRuntimeUsageTarget[]): IRuntimeUsageSnapshot[] =>
  targets.map((target, index) => {
    const critical = index === 0;
    const toolsHeavy = index === 1;
    if (index === targets.length - 1 && targets.length > 1) {
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
    return {
      conversationId: target.conversationId,
      processId: target.processId,
      processStartTimeMs: Date.now() - 3_600_000,
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
