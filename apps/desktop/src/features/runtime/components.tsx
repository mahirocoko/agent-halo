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

const LocalServiceRow = ({ onOpen, service }: { onOpen: (service: ILocalService) => void; service: ILocalService }) => (
  <li className="runtime-service-row" data-service-kind={service.kind}>
    <div className="runtime-row-main runtime-service-main">
      <span className="runtime-pressure-mark runtime-service-mark" aria-hidden="true" />
      <div className="runtime-identity">
        <span className="runtime-project">{service.processName}</span>
        <span className="runtime-conversation">{formatLocalServiceEndpoint(service)}</span>
      </div>
      <span className="runtime-service-kind">{service.kind === "http" ? "HTTP" : "TCP"}</span>
      {service.url ? (
        <button className="row-btn runtime-service-open" type="button" onClick={() => onOpen(service)} aria-label={`Open ${service.processName} on port ${service.port}`} title="Open in browser">
          <ExternalLink size={12} strokeWidth={2.1} />
        </button>
      ) : null}
    </div>
    <div className="runtime-reason runtime-service-meta">PID {service.processId}{service.bindAddress === "0.0.0.0" || service.bindAddress === "::" ? " · all interfaces" : " · local"}</div>
  </li>
);

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

export const RuntimePanel = ({ monitor }: { monitor: IRuntimeMonitorView }) => {
  const [hiddenRows, setHiddenRows] = useState<Set<string>>(() => new Set());
  const [serviceOpenError, setServiceOpenError] = useState<string | null>(null);
  const rows = useMemo(() => monitor.rows.filter((row) => !hiddenRows.has(runtimeRowKey(row))), [hiddenRows, monitor.rows]);
  const alertCount = rows.filter((row) => row.pressure === "high" || row.pressure === "critical").length;
  const hiddenSummary = [
    monitor.endedCount > 0 ? `${monitor.endedCount} ended hidden` : null,
    monitor.omittedCount > 0 ? `${monitor.omittedCount} older not sampled` : null,
  ].filter(Boolean).join(" · ");
  const refresh = () => {
    setHiddenRows(new Set());
    monitor.refresh();
  };
  const hide = (row: IRuntimeSessionView) => {
    setHiddenRows((current) => new Set(current).add(runtimeRowKey(row)));
  };
  const openService = async (service: ILocalService) => {
    setServiceOpenError(null);
    if (!(await openLocalService(service))) setServiceOpenError("Could not open local service");
  };
  return (
    <section className="runtime-panel" aria-label="Runtime monitor">
      <div className="runtime-toolbar">
        <div className="runtime-subtitle">Local services and process pressure</div>
        <div className="runtime-toolbar-actions">
          {hiddenSummary ? <span className="runtime-ended-count" role="status" aria-live="polite" aria-atomic="true">{hiddenSummary}</span> : null}
          {alertCount > 0 ? <span className="runtime-alert-count"><TriangleAlert size={12} /> {alertCount}</span> : null}
          <button className="gear-btn" type="button" onClick={refresh} disabled={monitor.loading} aria-label="Refresh runtime metrics" title="Refresh metrics and restore temporarily hidden diagnostic rows">
            <RefreshCw size={13} className={monitor.loading ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>
      {monitor.error ? <div className="notice-row compact" data-online="false" role="status">{monitor.error}</div> : null}
      <section aria-labelledby="runtime-processes-heading">
        <div className="session-section-head">
          <span id="runtime-processes-heading">Letta process pressure</span>
        </div>
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
      </section>
      <section aria-labelledby="runtime-services-heading">
        <div className="session-section-head">
          <span id="runtime-services-heading">Local services</span>
          <span className="session-section-count">{monitor.services.length}</span>
          {monitor.servicesLoading ? <span role="status">Checking…</span> : null}
        </div>
        {monitor.servicesError ? <div className="notice-row compact" data-online="false" role="status">{monitor.servicesError}</div> : null}
        {serviceOpenError ? <div className="notice-row compact" data-online="false" role="status">{serviceOpenError}</div> : null}
        {monitor.services.length === 0 ? (
          <div className="empty-text small">No listening TCP services detected</div>
        ) : (
          <ul className="runtime-list">
            {monitor.services.map((service) => <LocalServiceRow key={`${service.processId}:${service.bindAddress}:${service.port}`} onOpen={openService} service={service} />)}
          </ul>
        )}
      </section>
      <div className="runtime-footnote">Read-only · local listener names/PIDs only · 100% CPU equals one logical core · no process controls</div>
    </section>
  );
};
