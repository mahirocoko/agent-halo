import type { ISessionSummary, SessionEventRegistry } from '../session/types'

export type RuntimePressureLevel = 'normal' | 'elevated' | 'high' | 'critical' | 'unavailable'

export type IRuntimeUsageTarget = {
  conversationId: string
  runtimeEventId: string
  processId: number
  sourceStartedAtMs: number
  sourceKind?: string
  cwd: string | null
  project: string
  workspace: string
  herdrPaneId: string | null
  sessionStatus: ISessionSummary['status']
  lastActivityAt: string
  relatedConversationCount: number
  mappingStatus: 'exact' | 'sharedProcess'
}

export interface IRuntimeNativeTarget {
  conversationId: string
  eventId: string
  processId: number
  expectedStartTimeMs: number
  cwd: string | null
}

export interface ILocalServiceOwnerTarget {
  conversationId: string
  processId: number
  expectedStartTimeMs: number
  project: string
  herdrPaneId: string | null
}

export interface IRuntimeProcessMetrics {
  physicalFootprintBytes: number
  residentSizeBytes: number
  cpuPercent: number | null
}

export interface IRuntimeChildProcess {
  processId: number
  name: string
  physicalFootprintBytes: number
  cpuPercent: number | null
}

export interface IRuntimeChildMetrics {
  processCount: number
  physicalFootprintBytes: number
  residentSizeBytes: number
  cpuPercent: number | null
  topProcesses: IRuntimeChildProcess[]
}

export type LocalServiceKind = 'http' | 'tcp'

export interface ILocalServiceOwner {
  conversationId: string
  project: string
  herdrPaneId: string | null
}

export interface ILocalService {
  processId: number
  processStartTimeMs: number | null
  processName: string
  parentProcessId: number | null
  parentProcessName: string | null
  executablePath: string | null
  userId: number | null
  physicalFootprintBytes: number | null
  residentSizeBytes: number | null
  bindAddress: string
  port: number
  kind: LocalServiceKind
  webFrontend: boolean
  httpTitle: string | null
  url: string | null
  cwd: string | null
  owner: ILocalServiceOwner | null
  controlAvailable: boolean
  controlUnavailableReason: string | null
}

export type LocalServiceControlMode = 'stop' | 'forceKill'

export interface ILocalServiceControlRequest {
  processId: number
  processStartTimeMs: number
  bindAddress: string
  port: number
  mode: LocalServiceControlMode
}

export interface ILocalServiceControlResult {
  processId: number
  bindAddress: string
  port: number
  status:
    | 'stopped'
    | 'killed'
    | 'alreadyStopped'
    | 'listenerStopped'
    | 'stillRunning'
    | 'identityChanged'
    | 'notAllowed'
    | 'permissionDenied'
    | 'revalidationUnavailable'
    | 'failed'
    | 'unsupported'
    | string
  signal: 'SIGTERM' | 'SIGKILL' | null
  stillListening: boolean
  error: string | null
}

export interface ILocalServicesSnapshot {
  sampledAtMs: number
  status: 'ok' | 'unsupported' | 'error' | string
  error: string | null
  services: ILocalService[]
}

export interface IRuntimeUsageSnapshot {
  conversationId: string
  processId: number
  targetSourceStartedAtMs?: number | null
  processStartTimeMs: number | null
  cwd: string | null
  sampledAtMs: number
  status: 'ok' | 'missing' | 'identityMismatch' | 'pidReused' | 'unsupported' | 'unavailable' | string
  error: string | null
  host: IRuntimeProcessMetrics | null
  children: IRuntimeChildMetrics | null
}

export interface IRuntimeSessionView extends IRuntimeUsageTarget {
  snapshot: IRuntimeUsageSnapshot | null
  pressure: RuntimePressureLevel
  pressureReason: string
}

export interface IRuntimeMonitorView {
  rows: IRuntimeSessionView[]
  endedConversationIds: ReadonlySet<string>
  services: ILocalService[]
  servicesError: string | null
  servicesLoading: boolean
  endedCount: number
  omittedCount: number
  loading: boolean
  error: string | null
  sampledAtMs: number | null
  refreshProcesses: () => void
  refreshServices: () => void
  controlLocalService: (request: ILocalServiceControlRequest) => Promise<ILocalServiceControlResult>
}

export interface IRuntimeTargetSource {
  sessions: ISessionSummary[]
  registry: SessionEventRegistry
}
