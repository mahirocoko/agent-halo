import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw, TriangleAlert, X } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { formatLocalServiceEndpoint, formatRuntimeBytes, formatRuntimeCpu } from "./model";
import type { ILocalService, IRuntimeMonitorView, IRuntimeSessionView } from "./types";

const runtimeRowKey = (row: IRuntimeSessionView): string => `${row.processId}:${row.conversationId}`;

const openLocalServiceWindow = (url: string): boolean => {
  try {
    return window.open(url, "_blank", "noopener,noreferrer") !== null;
  } catch {
    return false;
  }
};

const openLocalService = async (service: ILocalService): Promise<boolean> => {
  if (!service.url) return false;
  if (typeof window.__TAURI_INTERNALS__ === "undefined") {
    return openLocalServiceWindow(service.url);
  }
  try {
    await invoke("open_external_url", { url: service.url });
    return true;
  } catch {
    return openLocalServiceWindow(service.url);
  }
};

const LocalServiceRow = ({ onOpen, service }: { onOpen: (service: ILocalService) => void; service: ILocalService }) => {
  const genericTitle = service.httpTitle?.toLowerCase().startsWith("directory listing") || service.httpTitle?.toLowerCase().startsWith("index of ");
  const displayTitle = service.httpTitle && !genericTitle ? service.httpTitle : service.processName;
  const cwdName = service.cwd?.split("/").filter(Boolean).at(-1) ?? null;
  const ownerLabel = service.owner
    ? `Started by Letta · ${service.owner.project}${service.owner.herdrPaneId ? ` · ${service.owner.herdrPaneId}` : ""}`
    : null;
  return (
    <li className="runtime-service-row" data-service-kind={service.kind} data-web-frontend={service.webFrontend}>
      <div className="runtime-row-main runtime-service-main">
        <span className="runtime-pressure-mark runtime-service-mark" aria-hidden="true" />
        <div className="runtime-identity">
          <span className="runtime-project" title={service.httpTitle ?? undefined}>{displayTitle}</span>
          <span className="runtime-conversation">{formatLocalServiceEndpoint(service)}{displayTitle !== service.processName ? ` · ${service.processName}` : ""}</span>
        </div>
        <span className="runtime-service-kind">{service.kind === "http" ? "HTTP" : "TCP"}</span>
        {service.url ? (
          <button className="row-btn runtime-service-open" type="button" onClick={() => onOpen(service)} aria-label={`Open ${displayTitle} on port ${service.port}`} title="Open in browser">
            <ExternalLink size={12} strokeWidth={2.1} />
          </button>
        ) : null}
      </div>
      <div className="runtime-reason runtime-service-meta">
        <span title={service.cwd ?? undefined}>PID {service.processId}{service.bindAddress === "0.0.0.0" || service.bindAddress === "::" ? " · all interfaces" : " · local"}{cwdName ? ` · ${cwdName}` : ""}</span>
        {ownerLabel ? <span className="runtime-service-owner" title={service.owner?.conversationId}>{ownerLabel}</span> : null}
      </div>
    </li>
  );
};

const LocalServiceGroup = ({ id, label, onOpen, services }: { id: string; label: string; onOpen: (service: ILocalService) => void; services: ILocalService[] }) => {
  if (services.length === 0) return null;
  const headingId = `runtime-services-${id}-heading`;
  return (
    <section data-service-group={id} aria-labelledby={headingId}>
      <div className="session-section-head">
        <span id={headingId}>{label}</span>
        <span className="runtime-group-count">{services.length}</span>
      </div>
      <ul className="runtime-list">
        {services.map((service) => <LocalServiceRow key={`${service.processId}:${service.bindAddress}:${service.port}`} onOpen={onOpen} service={service} />)}
      </ul>
    </section>
  );
};

const RuntimeRow = ({ onHide, row }: { onHide: (row: IRuntimeSessionView) => void; row: IRuntimeSessionView }) => {
  const host = row.snapshot?.host;
  const children = row.snapshot?.children;
  return (
    <li className="runtime-row" data-pressure={row.pressure}>
      <div className="runtime-row-main">
        <span className="runtime-pressure-mark" aria-hidden="true" />
        <div className="runtime-identity">
          <span className="runtime-project">{row.project}</span>
          <span className="runtime-conversation">{row.conversationId}</span>
        </div>
        <div className="runtime-row-status">
          <span className="runtime-pressure-label">{row.pressure === "unavailable" ? "Unavailable" : row.pressure}</span>
          {row.pressure === "unavailable" ? (
            <button className="row-btn runtime-hide-btn" type="button" onClick={() => onHide(row)} aria-label={`Hide unavailable runtime row for ${row.project}`} title="Hide until Runtime refresh">
              <X size={11} strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      <div className="runtime-metrics">
        <span><b>Letta</b> {formatRuntimeBytes(host?.physicalFootprintBytes)} · {formatRuntimeCpu(host?.cpuPercent)}</span>
        <span><b>Subprocesses</b> {formatRuntimeBytes(children?.physicalFootprintBytes)} · {formatRuntimeCpu(children?.cpuPercent)} · {children?.processCount ?? 0}</span>
      </div>
      <div className="runtime-reason">
        <span>{row.pressureReason}</span>
        <span>PID {row.processId}</span>
        {row.mappingStatus === "sharedProcess" ? <span>Shared by {row.relatedConversationCount} conversations</span> : null}
      </div>
    </li>
  );
};

export const RuntimeProcessesPanel = ({ monitor }: { monitor: IRuntimeMonitorView }) => {
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => new Set());
  const rows = useMemo(() => monitor.rows.filter((row) => !hiddenRows.has(runtimeRowKey(row))), [hiddenRows, monitor.rows]);
  const alertCount = rows.filter((row) => row.pressure === "high" || row.pressure === "critical").length;
  const hiddenSummary = [
    monitor.endedCount > 0 ? `${monitor.endedCount} ended hidden` : null,
    monitor.omittedCount > 0 ? `${monitor.omittedCount} older not sampled` : null,
  ].filter(Boolean).join(" · ");
  const refresh = () => {
    setHiddenRows(new Set());
    monitor.refreshProcesses();
  };
  const hide = (row: IRuntimeSessionView) => {
    setHiddenRows((current) => new Set(current).add(runtimeRowKey(row)));
  };
  return (
    <section className="runtime-panel" aria-label="Runtime process monitor">
      <div className="runtime-toolbar">
        <div className="runtime-subtitle">Letta and subprocess pressure</div>
        <div className="runtime-toolbar-actions">
          {hiddenSummary ? <span className="runtime-ended-count" role="status" aria-live="polite" aria-atomic="true">{hiddenSummary}</span> : null}
          {alertCount > 0 ? <span className="runtime-alert-count"><TriangleAlert size={12} /> {alertCount}</span> : null}
          <button className="gear-btn" type="button" onClick={refresh} disabled={monitor.loading} aria-busy={monitor.loading} aria-label={monitor.loading ? "Refreshing Runtime" : "Refresh Runtime"} title="Refresh process pressure">
            <RefreshCw size={13} className={monitor.loading ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>
      {monitor.error ? <div className="notice-row compact" data-online="false" role="status">{monitor.error}</div> : null}
      {rows.length === 0 ? (
        <div className="empty-state runtime-empty">
          <div className="empty-text">{monitor.endedCount > 0 ? "No live Letta processes" : "No PID-aware events yet"}</div>
          <div className="empty-text small">{monitor.endedCount > 0 ? `${monitor.endedCount} ended runtime ${monitor.endedCount === 1 ? "record is" : "records are"} hidden` : "Install the current mod, then reload active Letta sessions."}</div>
        </div>
      ) : (
        <ul className="runtime-list">
          {rows.map((row) => <RuntimeRow key={runtimeRowKey(row)} row={row} onHide={hide} />)}
        </ul>
      )}
      <div className="runtime-footnote">Read-only · 100% CPU equals one logical core · no process controls</div>
    </section>
  );
};

export const LocalServicesPanel = ({ monitor }: { monitor: IRuntimeMonitorView }) => {
  const [serviceOpenError, setServiceOpenError] = useState<string | null>(null);
  const webFrontends = useMemo(() => monitor.services.filter((service) => service.webFrontend), [monitor.services]);
  const lettaServices = useMemo(() => monitor.services.filter((service) => !service.webFrontend && service.owner), [monitor.services]);
  const otherServices = useMemo(() => monitor.services.filter((service) => !service.webFrontend && !service.owner), [monitor.services]);
  const openService = async (service: ILocalService) => {
    setServiceOpenError(null);
    if (!(await openLocalService(service))) setServiceOpenError("Could not open local service");
  };
  return (
    <section className="runtime-panel" aria-label="Local services">
      <div className="runtime-toolbar">
        <div className="runtime-subtitle">{monitor.services.length} local listeners</div>
        <div className="runtime-toolbar-actions">
          {monitor.servicesLoading ? <span className="runtime-ended-count" role="status">Checking…</span> : null}
          <button className="gear-btn" type="button" onClick={monitor.refreshServices} disabled={monitor.servicesLoading} aria-busy={monitor.servicesLoading} aria-label={monitor.servicesLoading ? "Refreshing Services" : "Refresh Services"} title="Refresh local services">
            <RefreshCw size={13} className={monitor.servicesLoading ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>
      {monitor.servicesError ? <div className="notice-row compact" data-online="false" role="status">{monitor.servicesError}</div> : null}
      {serviceOpenError ? <div className="notice-row compact" data-online="false" role="status">{serviceOpenError}</div> : null}
      {monitor.services.length === 0 ? (
        <div className="empty-text small">No listening TCP services detected</div>
      ) : (
        <div className="runtime-service-groups">
          <LocalServiceGroup id="web-frontends" label="Detected web frontends" services={webFrontends} onOpen={openService} />
          <LocalServiceGroup id="letta-services" label="Letta services" services={lettaServices} onOpen={openService} />
          <LocalServiceGroup id="other" label="Other listeners" services={otherServices} onOpen={openService} />
        </div>
      )}
      <div className="runtime-footnote">Read-only · web evidence first, then exact Letta ancestry · no service controls</div>
    </section>
  );
};
