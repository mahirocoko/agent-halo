import { useMemo, useState } from "react";
import { RefreshCw, TriangleAlert, X } from "lucide-react";
import { formatRuntimeBytes, formatRuntimeCpu } from "./model";
import type { IRuntimeMonitorView, IRuntimeSessionView } from "./types";

const runtimeRowKey = (row: IRuntimeSessionView): string => `${row.processId}:${row.conversationId}`;

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
  const rows = useMemo(() => monitor.rows.filter((row) => !hiddenRows.has(runtimeRowKey(row))), [hiddenRows, monitor.rows]);
  const alertCount = rows.filter((row) => row.pressure === "high" || row.pressure === "critical").length;
  const refresh = () => {
    setHiddenRows(new Set());
    monitor.refresh();
  };
  const hide = (row: IRuntimeSessionView) => {
    setHiddenRows((current) => new Set(current).add(runtimeRowKey(row)));
  };
  return (
    <section className="runtime-panel" aria-label="Runtime monitor">
      <div className="runtime-toolbar">
        <div className="runtime-subtitle">Local host and child-process pressure</div>
        <div className="runtime-toolbar-actions">
          {alertCount > 0 ? <span className="runtime-alert-count"><TriangleAlert size={12} /> {alertCount}</span> : null}
          <button className="gear-btn" type="button" onClick={refresh} disabled={monitor.loading} aria-label="Refresh runtime metrics" title="Refresh metrics and restore hidden rows">
            <RefreshCw size={13} className={monitor.loading ? "is-spinning" : undefined} />
          </button>
        </div>
      </div>
      {monitor.error ? <div className="notice-row compact" data-online="false" role="status">{monitor.error}</div> : null}
      {rows.length === 0 ? (
        <div className="empty-state runtime-empty">
          <div className="empty-text">No PID-aware events yet</div>
          <div className="empty-text small">Install the current mod, then reload active Letta sessions.</div>
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
