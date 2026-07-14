import { ChevronDown, ChevronRight, Focus, X } from "lucide-react";
import { formatRelativeAge, formatTime, shortModelName } from "./activity";
import { SessionMascot } from "./HaloSoftCube";
import type { ISessionDetail, ISessionSummary, IWorkspaceSessionGroup } from "./types";

export const StatusGlyph = ({ status }: { status: ISessionSummary["status"] }) => {
  if (status === "working") return <span className="status-slot"><span className="glyph-pulse">✱</span></span>;
  if (status === "attention") return <span className="status-slot"><span className="glyph-attention">!</span></span>;
  if (status === "done") return <span className="status-slot"><span className="glyph-check">✓</span></span>;
  return <span className="status-slot"><span className={`status-dot status-${status}`} /></span>;
};
const statusLabel = (status: ISessionSummary["status"]) => ({ attention: "Needs input", done: "Done", error: "Error", idle: "Idle", inactive: "Inactive", working: "Working" }[status]);
const shortSessionId = (id: string) => id.replace(/^local-conv-/, "").slice(-8);

export const SessionContextSummary = ({ session }: { session: ISessionDetail }) => {
  const latest = session.events[0];
  const copy = (() => {
    switch (session.status) {
      case "working": return { eyebrow: "Current activity", title: session.activityKind === "thinking" || session.activityKind === "model" ? "Model is working" : "Working", detail: session.detail };
      case "attention": { const kind = latest?.type === "attention_requested" ? latest.data.kind : null; return { eyebrow: "Needs input", title: kind === "question" || session.activityKind === "asking" ? "Question requested" : "Approval requested", detail: session.detail }; }
      case "done": return { eyebrow: "Completed", title: "Turn completed", detail: session.detail };
      case "error": return { eyebrow: "Error", title: "Activity failed", detail: session.detail };
      case "inactive": return { eyebrow: "Inactive", title: "Activity paused", detail: "No recent terminal event" };
      case "idle": return { eyebrow: "Idle", title: "Ready", detail: session.detail };
    }
  })();
  return (
    <section className="session-context-summary" data-status={session.status} aria-labelledby="session-context-title" data-panel-focus-target tabIndex={-1}>
      <SessionMascot activityKind={session.activityKind} sessionId={session.conversationId} status={session.status} />
      <span className="session-context-copy"><span className="session-context-eyebrow">{copy.eyebrow}</span><span className="session-context-title" id="session-context-title">{copy.title}</span><span className="session-context-detail">{copy.detail}</span></span>
      <span className="session-context-meta"><span className="session-model">{shortModelName(session.model)}</span><span className="session-age" title={formatTime(session.lastActivityAt)}>{formatRelativeAge(session.lastActivityAt)}</span></span>
    </section>
  );
};

export interface ISessionListRowProps { child?: boolean; onClear: (id: string) => void; onFocus: (session: ISessionSummary) => void; onOpen: (id: string) => void; session: ISessionSummary; }
export const SessionListRow = ({ child = false, onClear, onFocus, onOpen, session }: ISessionListRowProps) => (
  <li className={`session-row ${child ? "session-child-row" : ""} ${session.status === "done" ? "ended" : ""}`} data-status={session.status}>
    <button className="session-row-main" type="button" onClick={() => onOpen(session.conversationId)} data-session-id={session.conversationId} data-tauri-drag-region="false" aria-label={`Open ${session.project} session details`}>
      {child ? <StatusGlyph status={session.status} /> : <SessionMascot activityKind={session.activityKind} sessionId={session.conversationId} status={session.status} />}
      <span className="session-label"><span className="session-title-line"><span className="session-project">{child ? shortSessionId(session.conversationId) : session.project}</span><span className={`session-inline-status status-text-${session.status}`}>{statusLabel(session.status)}</span></span><span className="session-activity">{session.detail}</span><span className="session-folder">{child ? session.project : session.workspace}</span></span>
      <span className="session-row-metadata" title={formatTime(session.lastActivityAt)}><span className="session-model">{shortModelName(session.model)}</span><span className="session-age">{formatRelativeAge(session.lastActivityAt)}</span></span>
    </button>
    <div className="session-row-actions"><button className="row-btn row-focus" type="button" onClick={() => onFocus(session)} data-tauri-drag-region="false" aria-label={`Focus ${session.project} session in Ghostty`}><Focus size={11} strokeWidth={2.4} /></button>{session.status === "done" ? <button className="row-btn row-clear" type="button" onClick={() => onClear(session.conversationId)} data-tauri-drag-region="false" aria-label={`Clear completed ${session.project} session`} title="Hide this completed session until it has fresh activity"><X size={12} strokeWidth={2.5} /></button> : null}</div>
  </li>
);

export interface IWorkspaceSessionGroupItemProps { expanded: boolean; group: IWorkspaceSessionGroup; groupKey: string; onClear: (id: string) => void; onClearGroup: (group: IWorkspaceSessionGroup) => void; onFocus: (session: ISessionSummary) => void; onOpen: (id: string) => void; onToggle: (key: string) => void; }
export const WorkspaceSessionGroupItem = ({ expanded, group, groupKey, onClear, onClearGroup, onFocus, onOpen, onToggle }: IWorkspaceSessionGroupItemProps) => {
  if (group.sessions.length === 1) return <SessionListRow session={group.sessions[0]} onClear={onClear} onFocus={onFocus} onOpen={onOpen} />;
  return (
    <li className="session-group-block" data-status={group.status}><div className="session-row session-group" data-status={group.status}>
      <button className="session-row-main session-group-main" type="button" onClick={() => onToggle(groupKey)} data-tauri-drag-region="false" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${group.project}, ${group.sessions.length} sessions`}>
        <span className="session-disclosure" aria-hidden="true">{expanded ? <ChevronDown size={12} strokeWidth={2.4} /> : <ChevronRight size={12} strokeWidth={2.4} />}</span><SessionMascot activityKind={group.activityKind} sessionId={group.primarySession.conversationId} status={group.status} />
        <span className="session-label"><span className="session-title-line"><span className="session-project">{group.project}</span><span className="session-group-count">×{group.sessions.length}</span><span className={`session-inline-status status-text-${group.status}`}>{statusLabel(group.status)}</span></span><span className="session-activity">{group.detail}</span><span className="session-folder">{group.workspace}</span></span>
        <span className="session-row-metadata" title={formatTime(group.lastActivityAt)}><span className="session-model">{shortModelName(group.primarySession.model)}</span><span className="session-age">{formatRelativeAge(group.lastActivityAt)}</span></span>
      </button>
      {group.sessions.every((session) => session.status === "done") ? <div className="session-row-actions"><button className="row-btn row-clear" type="button" onClick={() => onClearGroup(group)} data-tauri-drag-region="false" aria-label={`Clear completed ${group.project} group`} title="Hide every completed session in this group until it has fresh activity"><X size={12} strokeWidth={2.5} /></button></div> : null}
    </div>{expanded ? <ul className="session-child-list" aria-label={`${group.project} sessions`}>{group.sessions.map((session) => <SessionListRow child session={session} onClear={onClear} onFocus={onFocus} onOpen={onOpen} key={session.conversationId} />)}</ul> : null}</li>
  );
};
