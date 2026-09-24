import { invoke } from '@tauri-apps/api/core'
import { Activity, ChevronRight, ExternalLink, RefreshCw, Server, X } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BoardScroll, BoardSurface } from '../../components/board-surface'
import {
  type IResizableCardSpec,
  ResizableCardDivider,
  useResizableCardLayout,
} from '../../components/resizable-card-tray'
import { SurfaceControl } from '../../components/surface-control'
import { type ISurfaceStatusProps, SurfaceStatus } from '../../components/surface-status'
import {
  formatLocalServiceEndpoint,
  formatLocalServiceUptime,
  formatRuntimeBytes,
  formatRuntimeCpu,
  localServiceListenerKey,
} from './model'
import type {
  ILocalService,
  ILocalServiceControlResult,
  IRuntimeMonitorView,
  IRuntimeSessionView,
  LocalServiceControlMode,
} from './types'

const runtimeRowKey = (row: IRuntimeSessionView): string => `${row.processId}:${row.conversationId}`

const MONITOR_CARD_SPECS: IResizableCardSpec[] = [
  { id: 'overview', defaultRatio: 0.3 },
  { id: 'detail', defaultRatio: 0.7 },
]

const useMonitorDetailScroll = (contentCount: number, scrollTop: number) => {
  const detailScrollRef = useRef<HTMLDivElement>(null)
  const restoredRef = useRef(false)

  useLayoutEffect(() => {
    if (restoredRef.current) return
    let frame = 0
    let cancelled = false

    const restore = () => {
      const scroller = detailScrollRef.current
      if (!scroller) return
      if (scrollTop === 0) {
        restoredRef.current = true
        return
      }
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      if (maxScrollTop === 0) return
      scroller.scrollTop = Math.min(scrollTop, maxScrollTop)
      restoredRef.current = true
    }

    frame = window.requestAnimationFrame(() => {
      const scroller = detailScrollRef.current
      const surface = scroller?.closest<HTMLElement>('.halo-surface')
      const animations = surface?.getAnimations() ?? []
      if (animations.length === 0) {
        restore()
        return
      }
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (cancelled) return
        frame = window.requestAnimationFrame(restore)
      })
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frame)
    }
  }, [contentCount, scrollTop])

  return detailScrollRef
}

const pressureTone = (pressure: IRuntimeSessionView['pressure']): ISurfaceStatusProps['tone'] => {
  if (pressure === 'normal') return 'success'
  if (pressure === 'critical') return 'danger'
  if (pressure === 'unavailable') return 'neutral'
  return 'warning'
}

const openLocalServiceWindow = (url: string): boolean => {
  try {
    return window.open(url, '_blank', 'noopener,noreferrer') !== null
  } catch {
    return false
  }
}

const openLocalService = async (service: ILocalService): Promise<boolean> => {
  if (!service.url) return false
  if (typeof window.__TAURI_INTERNALS__ === 'undefined') return openLocalServiceWindow(service.url)
  try {
    await invoke('open_external_url', { url: service.url })
    return true
  } catch {
    return openLocalServiceWindow(service.url)
  }
}

type LocalServiceControlPhase =
  | 'idle'
  | 'confirmStop'
  | 'stopping'
  | 'stillRunning'
  | 'confirmForce'
  | 'forceKilling'
  | 'error'

const LocalServiceRow = ({
  expanded,
  onControl,
  onOpen,
  onResult,
  onToggle,
  service,
}: {
  expanded: boolean
  onControl: (service: ILocalService, mode: LocalServiceControlMode) => Promise<ILocalServiceControlResult>
  onOpen: (service: ILocalService) => void
  onResult: (message: string) => void
  onToggle: (service: ILocalService) => void
  service: ILocalService
}) => {
  const genericTitle =
    service.httpTitle?.toLowerCase().startsWith('directory listing') ||
    service.httpTitle?.toLowerCase().startsWith('index of ')
  const displayTitle = service.httpTitle && !genericTitle ? service.httpTitle : service.processName
  const ownerLabel = service.owner
    ? `Started by Letta · ${service.owner.project}${service.owner.herdrPaneId ? ` · ${service.owner.herdrPaneId}` : ''}`
    : null
  const detailsId = `local-service-${service.processId}-${service.port}-details`
  const [phase, setPhase] = useState<LocalServiceControlPhase>('idle')
  const [controlError, setControlError] = useState<string | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const busy = phase === 'stopping' || phase === 'forceKilling'
  const canControl = service.controlAvailable && service.processStartTimeMs != null

  useEffect(() => {
    if (phase === 'confirmStop' || phase === 'confirmForce') cancelButtonRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (!expanded && !busy) {
      setPhase('idle')
      setControlError(null)
    }
  }, [busy, expanded])

  const control = async (mode: LocalServiceControlMode) => {
    if (service.processStartTimeMs == null) return
    setControlError(null)
    setPhase(mode === 'stop' ? 'stopping' : 'forceKilling')
    const result = await onControl(service, mode)
    if (result.status === 'stillRunning') {
      setPhase('stillRunning')
      onResult(`${service.processName} did not stop`)
      return
    }
    if (['stopped', 'killed', 'alreadyStopped', 'listenerStopped'].includes(result.status)) {
      setPhase('idle')
      onResult(
        result.status === 'killed'
          ? `Force killed ${service.processName}`
          : result.status === 'listenerStopped'
            ? `Listener stopped; ${service.processName} is still running`
            : `Stopped ${service.processName}`,
      )
      return
    }
    setPhase('error')
    const message = result.error ?? 'Could not control this process'
    setControlError(message)
    onResult(message)
  }

  const cancelConfirmation = () => {
    setPhase(phase === 'confirmForce' ? 'stillRunning' : 'idle')
    setControlError(null)
  }

  const handleDetailsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || busy) return
    if (phase === 'confirmStop' || phase === 'confirmForce') {
      event.preventDefault()
      event.stopPropagation()
      cancelConfirmation()
    }
  }

  return (
    <li
      className="runtime-service-row"
      data-expanded={expanded}
      data-service-kind={service.kind}
      data-web-frontend={service.webFrontend}
    >
      <div className="runtime-row-main runtime-service-main">
        <span className="runtime-pressure-mark runtime-service-mark" aria-hidden="true" />
        <button
          className="runtime-service-disclosure"
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${displayTitle} service details on port ${service.port}`}
          onClick={() => onToggle(service)}
        >
          <span className="runtime-identity">
            <span className="runtime-project" title={service.httpTitle ?? undefined}>
              {displayTitle}
            </span>
            <span className="runtime-conversation">
              {formatLocalServiceEndpoint(service)}
              {displayTitle !== service.processName ? ` · ${service.processName}` : ''}
            </span>
          </span>
          <ChevronRight className="runtime-service-chevron" size={12} strokeWidth={2} aria-hidden="true" />
        </button>
        <span className="runtime-service-kind">{service.kind === 'http' ? 'HTTP' : 'TCP'}</span>
        {service.url ? (
          <button
            className="row-btn runtime-service-open"
            type="button"
            onClick={() => onOpen(service)}
            aria-label={`Open ${displayTitle} on port ${service.port}`}
            title="Open in browser"
          >
            <ExternalLink size={12} strokeWidth={2.1} />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div id={detailsId} className="runtime-service-details" onKeyDown={handleDetailsKeyDown} aria-busy={busy}>
          <dl className="runtime-service-detail-list">
            <div>
              <dt>Process</dt>
              <dd>
                {service.processName} · PID {service.processId}
              </dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>
                {formatLocalServiceUptime(service.processStartTimeMs)} ago
                {service.userId != null ? ` · UID ${service.userId}` : ''}
              </dd>
            </div>
            <div>
              <dt>Memory</dt>
              <dd>
                {formatRuntimeBytes(service.physicalFootprintBytes)} footprint ·{' '}
                {formatRuntimeBytes(service.residentSizeBytes)} resident
              </dd>
            </div>
            <div>
              <dt>Parent</dt>
              <dd>
                {service.parentProcessName ?? 'Unknown'}
                {service.parentProcessId != null ? ` · PID ${service.parentProcessId}` : ''}
              </dd>
            </div>
            <div>
              <dt>Bind</dt>
              <dd>
                {service.bindAddress} ·{' '}
                {service.bindAddress === '0.0.0.0' || service.bindAddress === '::' ? 'all interfaces' : 'local only'}
              </dd>
            </div>
            {service.executablePath ? (
              <div>
                <dt>Executable</dt>
                <dd>{service.executablePath}</dd>
              </div>
            ) : null}
            {service.cwd ? (
              <div>
                <dt>Working directory</dt>
                <dd>{service.cwd}</dd>
              </div>
            ) : null}
            {ownerLabel ? (
              <div>
                <dt>Owner</dt>
                <dd title={service.owner?.conversationId}>{ownerLabel}</dd>
              </div>
            ) : null}
          </dl>
          <div className="runtime-service-control">
            {phase === 'confirmStop' || phase === 'confirmForce' ? (
              <div
                className="runtime-service-confirm"
                role="group"
                aria-label={`${phase === 'confirmForce' ? 'Force kill' : 'Stop'} ${service.processName}`}
              >
                <p>
                  {phase === 'confirmForce'
                    ? `Force kill ${service.processName} (PID ${service.processId})? Unsaved work may be lost.`
                    : `Stop ${service.processName} (PID ${service.processId})? This ends every listener owned by this process.`}
                </p>
                <div className="runtime-service-actions">
                  <button ref={cancelButtonRef} className="pill-btn" type="button" onClick={cancelConfirmation}>
                    Cancel
                  </button>
                  <button
                    className="pill-btn danger"
                    type="button"
                    onClick={() => void control(phase === 'confirmForce' ? 'forceKill' : 'stop')}
                  >
                    {phase === 'confirmForce' ? 'Force kill' : 'Stop process'}
                  </button>
                </div>
              </div>
            ) : busy ? (
              <span className="runtime-service-control-status" role="status">
                {phase === 'stopping' ? `Stopping ${service.processName}…` : `Force killing ${service.processName}…`}
              </span>
            ) : phase === 'stillRunning' ? (
              <div className="runtime-service-actions">
                <span className="runtime-service-control-status">Process did not stop.</span>
                <button className="pill-btn danger" type="button" onClick={() => setPhase('confirmForce')}>
                  Force kill…
                </button>
              </div>
            ) : (
              <div className="runtime-service-actions">
                {controlError ? (
                  <span className="runtime-service-control-error" role="status">
                    {controlError}
                  </span>
                ) : null}
                {canControl ? (
                  <button className="pill-btn danger" type="button" onClick={() => setPhase('confirmStop')}>
                    Stop process…
                  </button>
                ) : (
                  <span className="runtime-service-control-status">
                    {service.controlUnavailableReason ?? 'Process control unavailable'}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </li>
  )
}

const RuntimeSectionHeading = ({ count, headingId, label }: { count: number; headingId: string; label: string }) => (
  <div className="runtime-section-heading">
    <span id={headingId}>{label}</span>
    <span className="runtime-group-count">{count}</span>
  </div>
)

const LocalServiceGroup = ({
  expandedKey,
  id,
  label,
  onControl,
  onOpen,
  onResult,
  onToggle,
  services,
}: {
  expandedKey: string | null
  id: string
  label: string
  onControl: (service: ILocalService, mode: LocalServiceControlMode) => Promise<ILocalServiceControlResult>
  onOpen: (service: ILocalService) => void
  onResult: (message: string) => void
  onToggle: (service: ILocalService) => void
  services: ILocalService[]
}) => {
  if (services.length === 0) return null
  const headingId = `runtime-services-${id}-heading`
  return (
    <section data-service-group={id} aria-labelledby={headingId}>
      <RuntimeSectionHeading count={services.length} headingId={headingId} label={label} />
      <ul className="runtime-list">
        {services.map((service) => {
          const key = localServiceListenerKey(service)
          return (
            <LocalServiceRow
              key={key}
              expanded={expandedKey === key}
              onControl={onControl}
              onOpen={onOpen}
              onResult={onResult}
              onToggle={onToggle}
              service={service}
            />
          )
        })}
      </ul>
    </section>
  )
}

const RuntimeRow = ({ onHide, row }: { onHide: (row: IRuntimeSessionView) => void; row: IRuntimeSessionView }) => {
  const host = row.snapshot?.host
  const children = row.snapshot?.children
  return (
    <li className="runtime-row" data-pressure={row.pressure}>
      <div className="runtime-row-main">
        <span className="runtime-pressure-mark" aria-hidden="true" />
        <div className="runtime-identity">
          <span className="runtime-project">{row.project}</span>
          <span className="runtime-conversation">{row.conversationId}</span>
        </div>
        <div className="runtime-row-status">
          <SurfaceStatus className="runtime-pressure-label" tone={pressureTone(row.pressure)}>
            {row.pressure === 'unavailable' ? 'Unavailable' : row.pressure}
          </SurfaceStatus>
          {row.pressure === 'unavailable' ? (
            <button
              className="row-btn runtime-hide-btn"
              type="button"
              onClick={() => onHide(row)}
              aria-label={`Hide unavailable runtime row for ${row.project}`}
              title="Hide until Runtime refresh"
            >
              <X size={11} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="runtime-metrics">
        <span>
          <b>{row.sourceKind === 'agyHost' ? 'AGY' : 'Letta'}</b> {formatRuntimeBytes(host?.physicalFootprintBytes)} ·{' '}
          {formatRuntimeCpu(host?.cpuPercent)}
        </span>
        <span>
          <b>Subprocesses</b> {formatRuntimeBytes(children?.physicalFootprintBytes)} ·{' '}
          {formatRuntimeCpu(children?.cpuPercent)} · {children?.processCount ?? 0}
        </span>
      </div>
      <div className="runtime-reason">
        <span>{row.pressureReason}</span>
        <span>PID {row.processId}</span>
        {row.mappingStatus === 'sharedProcess' ? (
          <span>Shared by {row.relatedConversationCount} conversations</span>
        ) : null}
      </div>
    </li>
  )
}

const OverviewHeader = ({
  children,
  icon,
  title,
  titleId,
}: {
  children: ReactNode
  icon: ReactNode
  title: string
  titleId: string
}) => (
  <div className="runtime-overview-head">
    <span className="runtime-overview-icon" aria-hidden="true">
      {icon}
    </span>
    <div>
      <span className="runtime-overview-kicker">Monitor</span>
      <h2 id={titleId}>{title}</h2>
    </div>
    {children}
  </div>
)

export const RuntimeProcessesPanel = ({
  detailScrollTop,
  monitor,
}: {
  detailScrollTop: number
  monitor: IRuntimeMonitorView
}) => {
  const layout = useResizableCardLayout({ storageKey: 'agent-halo.runtime-layout.v1', specs: MONITOR_CARD_SPECS })
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => new Set())
  const rows = useMemo(
    () => monitor.rows.filter((row) => !hiddenRows.has(runtimeRowKey(row))),
    [hiddenRows, monitor.rows],
  )
  const detailScrollRef = useMonitorDetailScroll(rows.length, detailScrollTop)
  const warningCount = rows.filter((row) => row.pressure === 'elevated' || row.pressure === 'high').length
  const criticalCount = rows.filter((row) => row.pressure === 'critical').length
  const unavailableCount = rows.filter((row) => row.pressure === 'unavailable').length
  const hiddenSummary = [
    monitor.endedCount > 0 ? `${monitor.endedCount} ended hidden` : null,
    monitor.omittedCount > 0 ? `${monitor.omittedCount} older not sampled` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const refresh = () => {
    setHiddenRows(new Set())
    monitor.refreshProcesses()
  }
  const hide = (row: IRuntimeSessionView) => setHiddenRows((current) => new Set(current).add(runtimeRowKey(row)))

  return (
    <div
      className="monitor-tray runtime-board"
      data-testid="runtime-board"
      aria-label="Runtime process monitor"
      ref={layout.trayRef}
    >
      <BoardSurface
        className="monitor-card monitor-overview-card"
        tone="slate"
        aria-labelledby="runtime-overview-title"
        style={layout.cardStyle(0)}
      >
        <BoardScroll data-monitor-card="overview">
          <OverviewHeader
            icon={<Activity size={18} strokeWidth={2.1} />}
            title="Runtime"
            titleId="runtime-overview-title"
          >
            <SurfaceControl
              surfaceControlShape="circle"
              surfaceControlSize="icon"
              surfaceControlVariant="subtle"
              type="button"
              onClick={refresh}
              disabled={monitor.loading}
              aria-busy={monitor.loading}
              aria-label={monitor.loading ? 'Refreshing Runtime' : 'Refresh Runtime'}
              title="Refresh process pressure"
            >
              <RefreshCw size={13} className={monitor.loading ? 'is-spinning' : undefined} />
            </SurfaceControl>
          </OverviewHeader>
          <div className="runtime-primary-count">
            <strong>{rows.length}</strong>
            <span>visible processes</span>
          </div>
          <div className="runtime-summary-list" aria-label="Runtime summary">
            <div>
              <span>Critical</span>
              <SurfaceStatus tone={criticalCount > 0 ? 'danger' : 'success'}>{criticalCount}</SurfaceStatus>
            </div>
            <div>
              <span>Elevated or high</span>
              <SurfaceStatus tone={warningCount > 0 ? 'warning' : 'success'}>{warningCount}</SurfaceStatus>
            </div>
            <div>
              <span>Unavailable</span>
              <SurfaceStatus tone="neutral">{unavailableCount}</SurfaceStatus>
            </div>
          </div>
          {hiddenSummary ? (
            <span className="runtime-ended-count" role="status" aria-live="polite" aria-atomic="true">
              {hiddenSummary}
            </span>
          ) : null}
          <p className="runtime-footnote">Read-only · 100% CPU equals one logical core · no process controls</p>
        </BoardScroll>
      </BoardSurface>
      <ResizableCardDivider layout={layout} index={0} label="Resize Runtime overview and process pressure" />
      <BoardSurface
        className="monitor-card monitor-detail-card"
        tone="navy"
        aria-labelledby="runtime-detail-title"
        style={layout.cardStyle(1)}
      >
        <div className="runtime-detail-heading">
          <div>
            <span className="runtime-overview-kicker">Live monitor</span>
            <h2 id="runtime-detail-title">Process pressure</h2>
          </div>
        </div>
        <BoardScroll ref={detailScrollRef} data-monitor-card="detail">
          {monitor.error ? (
            <div className="notice-row compact" data-online="false" role="status">
              {monitor.error}
            </div>
          ) : null}
          {rows.length === 0 ? (
            <div className="empty-state runtime-empty">
              <div className="empty-text">
                {monitor.endedCount > 0 ? 'No live agent processes' : 'No PID-aware events yet'}
              </div>
              <div className="empty-text small">
                {monitor.endedCount > 0
                  ? `${monitor.endedCount} ended runtime ${monitor.endedCount === 1 ? 'record is' : 'records are'} hidden`
                  : 'Install the current mod or hooks, then reload active sessions.'}
              </div>
            </div>
          ) : (
            <ul className="runtime-list">
              {rows.map((row) => (
                <RuntimeRow key={runtimeRowKey(row)} row={row} onHide={hide} />
              ))}
            </ul>
          )}
        </BoardScroll>
      </BoardSurface>
    </div>
  )
}

export const LocalServicesPanel = ({
  detailScrollTop,
  monitor,
}: {
  detailScrollTop: number
  monitor: IRuntimeMonitorView
}) => {
  const layout = useResizableCardLayout({ storageKey: 'agent-halo.services-layout.v1', specs: MONITOR_CARD_SPECS })
  const [serviceOpenError, setServiceOpenError] = useState<string | null>(null)
  const [expandedServiceKey, setExpandedServiceKey] = useState<string | null>(null)
  const [controlAnnouncement, setControlAnnouncement] = useState('')
  const webFrontends = useMemo(() => monitor.services.filter((service) => service.webFrontend), [monitor.services])
  const lettaServices = useMemo(
    () => monitor.services.filter((service) => !service.webFrontend && service.owner),
    [monitor.services],
  )
  const otherServices = useMemo(
    () => monitor.services.filter((service) => !service.webFrontend && !service.owner),
    [monitor.services],
  )
  const detailScrollRef = useMonitorDetailScroll(monitor.services.length, detailScrollTop)

  useEffect(() => {
    if (
      expandedServiceKey &&
      !monitor.services.some((service) => localServiceListenerKey(service) === expandedServiceKey)
    )
      setExpandedServiceKey(null)
  }, [expandedServiceKey, monitor.services])

  const openService = async (service: ILocalService) => {
    setServiceOpenError(null)
    if (!(await openLocalService(service))) setServiceOpenError('Could not open local service')
  }
  const toggleService = (service: ILocalService) => {
    const key = localServiceListenerKey(service)
    setExpandedServiceKey((current) => (current === key ? null : key))
  }
  const controlService = (service: ILocalService, mode: LocalServiceControlMode) => {
    if (service.processStartTimeMs == null) {
      return Promise.resolve({
        processId: service.processId,
        bindAddress: service.bindAddress,
        port: service.port,
        status: 'notAllowed' as const,
        signal: null,
        stillListening: true,
        error: 'Process identity is unavailable',
      })
    }
    return monitor.controlLocalService({
      processId: service.processId,
      processStartTimeMs: service.processStartTimeMs,
      bindAddress: service.bindAddress,
      port: service.port,
      mode,
    })
  }

  return (
    <div
      className="monitor-tray services-board"
      data-testid="services-board"
      aria-label="Local services"
      ref={layout.trayRef}
    >
      <BoardSurface
        className="monitor-card monitor-overview-card"
        tone="slate"
        aria-labelledby="services-overview-title"
        style={layout.cardStyle(0)}
      >
        <BoardScroll data-monitor-card="overview">
          <OverviewHeader
            icon={<Server size={18} strokeWidth={2.1} />}
            title="Services"
            titleId="services-overview-title"
          >
            <SurfaceControl
              surfaceControlShape="circle"
              surfaceControlSize="icon"
              surfaceControlVariant="subtle"
              type="button"
              onClick={monitor.refreshServices}
              disabled={monitor.servicesLoading}
              aria-busy={monitor.servicesLoading}
              aria-label={monitor.servicesLoading ? 'Refreshing Services' : 'Refresh Services'}
              title="Refresh local services"
            >
              <RefreshCw size={13} className={monitor.servicesLoading ? 'is-spinning' : undefined} />
            </SurfaceControl>
          </OverviewHeader>
          <div className="runtime-primary-count">
            <strong>{monitor.services.length}</strong>
            <span>local listeners</span>
          </div>
          <div className="runtime-summary-list" aria-label="Service summary">
            <div>
              <span>Web frontends</span>
              <SurfaceStatus tone={webFrontends.length > 0 ? 'success' : 'neutral'}>
                {webFrontends.length}
              </SurfaceStatus>
            </div>
            <div>
              <span>Letta services</span>
              <SurfaceStatus tone="info">{lettaServices.length}</SurfaceStatus>
            </div>
            <div>
              <span>Other listeners</span>
              <SurfaceStatus tone="neutral">{otherServices.length}</SurfaceStatus>
            </div>
          </div>
          {monitor.servicesLoading ? (
            <span className="runtime-ended-count" role="status">
              Checking…
            </span>
          ) : null}
          <p className="runtime-footnote">Web evidence first · exact Letta ancestry · Stop requires confirmation</p>
        </BoardScroll>
      </BoardSurface>
      <ResizableCardDivider layout={layout} index={0} label="Resize Services overview and listening services" />
      <BoardSurface
        className="monitor-card monitor-detail-card"
        tone="teal"
        aria-labelledby="services-detail-title"
        style={layout.cardStyle(1)}
      >
        <div className="runtime-detail-heading">
          <div>
            <span className="runtime-overview-kicker">Local machine</span>
            <h2 id="services-detail-title">Listening services</h2>
          </div>
        </div>
        <BoardScroll ref={detailScrollRef} data-monitor-card="detail">
          {monitor.servicesError ? (
            <div className="notice-row compact" data-online="false" role="status">
              {monitor.servicesError}
            </div>
          ) : null}
          {serviceOpenError ? (
            <div className="notice-row compact" data-online="false" role="status">
              {serviceOpenError}
            </div>
          ) : null}
          <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {controlAnnouncement}
          </span>
          {monitor.services.length === 0 ? (
            <div className="empty-text small">No listening TCP services detected</div>
          ) : (
            <div className="runtime-service-groups">
              <LocalServiceGroup
                expandedKey={expandedServiceKey}
                id="web-frontends"
                label="Detected web frontends"
                services={webFrontends}
                onControl={controlService}
                onOpen={openService}
                onResult={setControlAnnouncement}
                onToggle={toggleService}
              />
              <LocalServiceGroup
                expandedKey={expandedServiceKey}
                id="letta-services"
                label="Letta services"
                services={lettaServices}
                onControl={controlService}
                onOpen={openService}
                onResult={setControlAnnouncement}
                onToggle={toggleService}
              />
              <LocalServiceGroup
                expandedKey={expandedServiceKey}
                id="other"
                label="Other listeners"
                services={otherServices}
                onControl={controlService}
                onOpen={openService}
                onResult={setControlAnnouncement}
                onToggle={toggleService}
              />
            </div>
          )}
        </BoardScroll>
      </BoardSurface>
    </div>
  )
}
