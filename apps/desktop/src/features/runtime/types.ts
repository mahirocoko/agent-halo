import type { ISessionSummary, SessionEventRegistry } from "../session/types";

export type RuntimePressureLevel = "normal" | "elevated" | "high" | "critical" | "unavailable";

export interface IRuntimeUsageTarget {
  conversationId: string;
  runtimeEventId: string;
  processId: number;
  sourceStartedAtMs: number;
  cwd: string | null;
  project: string;
  workspace: string;
  sessionStatus: ISessionSummary["status"];
  lastActivityAt: string;
  relatedConversationCount: number;
  mappingStatus: "exact" | "sharedProcess";
}

export interface IRuntimeNativeTarget {
  conversationId: string;
  eventId: string;
  processId: number;
  expectedStartTimeMs: number;
  cwd: string | null;
}

export interface IRuntimeProcessMetrics {
  physicalFootprintBytes: number;
  residentSizeBytes: number;
  cpuPercent: number | null;
}

export interface IRuntimeChildProcess {
  processId: number;
  name: string;
  physicalFootprintBytes: number;
  cpuPercent: number | null;
}

export interface IRuntimeChildMetrics {
  processCount: number;
  physicalFootprintBytes: number;
  residentSizeBytes: number;
  cpuPercent: number | null;
  topProcesses: IRuntimeChildProcess[];
}

export interface IRuntimeUsageSnapshot {
  conversationId: string;
  processId: number;
  processStartTimeMs: number | null;
  cwd: string | null;
  sampledAtMs: number;
  status: "ok" | "missing" | "identityMismatch" | "pidReused" | "unsupported" | "unavailable" | string;
  error: string | null;
  host: IRuntimeProcessMetrics | null;
  children: IRuntimeChildMetrics | null;
}

export interface IRuntimeSessionView extends IRuntimeUsageTarget {
  snapshot: IRuntimeUsageSnapshot | null;
  pressure: RuntimePressureLevel;
  pressureReason: string;
}

export interface IRuntimeMonitorView {
  rows: IRuntimeSessionView[];
  loading: boolean;
  error: string | null;
  sampledAtMs: number | null;
  refresh: () => void;
}

export interface IRuntimeTargetSource {
  sessions: ISessionSummary[];
  registry: SessionEventRegistry;
}
