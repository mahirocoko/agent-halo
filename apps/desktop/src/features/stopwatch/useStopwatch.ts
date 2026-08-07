import { useEffect, useMemo, useRef, useState } from "react";
import { discardStopwatch, finishStopwatch, formatStopwatchCompact, formatStopwatchElapsed, getStopwatchElapsedMs, pauseStopwatch, startStopwatch } from "./model";
import { MAX_STOPWATCH_HISTORY_ENTRIES, readStopwatchHistory, readStopwatchState, writeStopwatchHistory, writeStopwatchState } from "./persistence";
import type { IStopwatchHistory, IStopwatchState, IStopwatchView } from "./types";

const createHistoryId = (): string => {
  try { return crypto.randomUUID(); } catch { return `stopwatch-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
};

export interface IUseStopwatchResult extends IStopwatchView {
  start: () => void;
  pause: () => void;
  finish: () => void;
  discard: () => void;
  clearHistory: () => void;
}

export const useStopwatch = (): IUseStopwatchResult => {
  const [state, setState] = useState<IStopwatchState>(readStopwatchState);
  const [history, setHistory] = useState<IStopwatchHistory>(readStopwatchHistory);
  const [now, setNow] = useState(Date.now);
  const stateRef = useRef(state);
  const historyRef = useRef(history);

  const commitState = (next: IStopwatchState): void => {
    stateRef.current = next;
    setState(next);
    writeStopwatchState(next);
  };

  const commitHistory = (next: IStopwatchHistory): void => {
    historyRef.current = next;
    setHistory(next);
    writeStopwatchHistory(next);
  };

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const handleVisibility = () => tick();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (state.status !== "running") return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [state.status]);

  const start = (): void => commitState(startStopwatch(stateRef.current, Date.now()));
  const pause = (): void => commitState(pauseStopwatch(stateRef.current, Date.now()));
  const discard = (): void => commitState(discardStopwatch());
  const finish = (): void => {
    const result = finishStopwatch(stateRef.current, Date.now(), createHistoryId());
    if (result === null) return;
    commitHistory({
      schemaVersion: 1,
      entries: [result.entry, ...historyRef.current.entries].slice(0, MAX_STOPWATCH_HISTORY_ENTRIES),
    });
    commitState(result.state);
  };
  const clearHistory = (): void => commitHistory({ schemaVersion: 1, entries: [] });

  const elapsedMs = getStopwatchElapsedMs(state, now);
  const view = useMemo<IStopwatchView>(() => ({
    state,
    history: history.entries,
    elapsedMs,
    elapsedLabel: formatStopwatchElapsed(elapsedMs),
    compactElapsedLabel: formatStopwatchCompact(elapsedMs),
  }), [elapsedMs, history.entries, state]);

  return { ...view, start, pause, finish, discard, clearHistory };
};
