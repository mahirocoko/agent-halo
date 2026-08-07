import { Clock3, History, Pause, Play, Square, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatStopwatchElapsed } from "./model";
import type { IStopwatchHistoryEntry } from "./types";
import type { IUseStopwatchResult } from "./useStopwatch";

export interface IStopwatchPanelProps {
  stopwatch: IUseStopwatchResult;
}

interface IStopwatchHistoryGroup {
  key: string;
  label: string;
  totalMs: number;
  entries: IStopwatchHistoryEntry[];
}

const dateKey = (timestamp: number): string => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const historyDateLabel = (timestamp: number, now = Date.now()): string => {
  const date = new Date(timestamp);
  const today = new Date(now);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dateKey(timestamp) === dateKey(now)) return "Today";
  if (dateKey(timestamp) === dateKey(yesterday.getTime())) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" }).format(date);
};

const historyTimeRange = (entry: IStopwatchHistoryEntry): string => {
  const formatter = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
  return `${formatter.format(entry.startedAt)}–${formatter.format(entry.endedAt)}`;
};

const groupHistory = (entries: IStopwatchHistoryEntry[]): IStopwatchHistoryGroup[] => {
  const groups = new Map<string, IStopwatchHistoryGroup>();
  for (const entry of entries) {
    const key = dateKey(entry.endedAt);
    const group = groups.get(key) ?? { key, label: historyDateLabel(entry.endedAt), totalMs: 0, entries: [] };
    group.totalMs += entry.durationMs;
    group.entries.push(entry);
    groups.set(key, group);
  }
  return Array.from(groups.values());
};

export const StopwatchPanel = ({ stopwatch }: IStopwatchPanelProps) => {
  const [discardArmed, setDiscardArmed] = useState(false);
  const [clearHistoryArmed, setClearHistoryArmed] = useState(false);
  const running = stopwatch.state.status === "running";
  const paused = stopwatch.state.status === "paused";
  const historyGroups = useMemo(() => groupHistory(stopwatch.history), [stopwatch.history]);

  useEffect(() => {
    setDiscardArmed(false);
  }, [stopwatch.state.status]);

  useEffect(() => {
    if (stopwatch.history.length === 0) setClearHistoryArmed(false);
  }, [stopwatch.history.length]);

  return (
    <section className="stopwatch-panel" data-status={stopwatch.state.status} aria-labelledby="stopwatch-heading">
      <div className="stopwatch-heading-row">
        <span className="stopwatch-icon" aria-hidden="true"><Clock3 size={13} strokeWidth={2.3} /></span>
        <h2 id="stopwatch-heading">Stopwatch</h2>
        <span className="stopwatch-status" data-status={stopwatch.state.status}>{running ? "Running" : paused ? "Paused" : "Ready"}</span>
      </div>

      <div className="stopwatch-clock" role="timer" aria-label={`Stopwatch, ${stopwatch.elapsedLabel} elapsed`}>
        {stopwatch.elapsedLabel}
      </div>

      <div className="stopwatch-controls">
        {running ? (
          <button className="stopwatch-control primary" type="button" onClick={stopwatch.pause} data-tauri-drag-region="false"><Pause size={14} strokeWidth={2.4} />Pause</button>
        ) : (
          <button className="stopwatch-control primary" type="button" onClick={stopwatch.start} data-tauri-drag-region="false"><Play size={14} strokeWidth={2.4} />{paused ? "Resume" : "Start"}</button>
        )}
        <button className="stopwatch-control" type="button" onClick={stopwatch.finish} disabled={stopwatch.state.status === "idle"} data-tauri-drag-region="false"><Square size={12} strokeWidth={2.4} />Finish</button>
        <button
          className={`stopwatch-control ${discardArmed ? "danger" : ""}`}
          type="button"
          disabled={stopwatch.state.status === "idle"}
          onClick={() => {
            if (!discardArmed) { setDiscardArmed(true); return; }
            stopwatch.discard();
            setDiscardArmed(false);
          }}
          data-tauri-drag-region="false"
          aria-label={discardArmed ? "Confirm discard current Stopwatch session" : "Discard current Stopwatch session"}
        >
          <Trash2 size={12} strokeWidth={2.3} />{discardArmed ? "Confirm discard" : "Discard"}
        </button>
      </div>

      <div className="stopwatch-history-heading">
        <span><History size={12} strokeWidth={2.2} />History</span>
        <button
          className={clearHistoryArmed ? "danger" : ""}
          type="button"
          disabled={stopwatch.history.length === 0}
          onClick={() => {
            if (!clearHistoryArmed) { setClearHistoryArmed(true); return; }
            stopwatch.clearHistory();
            setClearHistoryArmed(false);
          }}
          data-tauri-drag-region="false"
          aria-label={clearHistoryArmed ? "Confirm clear all Stopwatch history" : "Clear all Stopwatch history"}
        >
          <Trash2 size={11} strokeWidth={2.3} />{clearHistoryArmed ? "Confirm clear" : "Clear history"}
        </button>
      </div>

      {historyGroups.length === 0 ? (
        <div className="stopwatch-history-empty">Finished sessions will appear here.</div>
      ) : (
        <div className="stopwatch-history-list">
          {historyGroups.map((group) => (
            <section className="stopwatch-history-group" key={group.key} aria-label={`${group.label} Stopwatch history`}>
              <div className="stopwatch-history-date"><span>{group.label}</span><span>{formatStopwatchElapsed(group.totalMs)}</span></div>
              <ol>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <span>{historyTimeRange(entry)}</span>
                    <strong>{formatStopwatchElapsed(entry.durationMs)}</strong>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </section>
  );
};
