import type { IStopwatchFinishResult, IStopwatchState } from "./types";

export const STOPWATCH_STORAGE_KEY = "agent-halo.stopwatch";
export const STOPWATCH_HISTORY_STORAGE_KEY = "agent-halo.stopwatch-history";

export const createStopwatchState = (): IStopwatchState => ({
  schemaVersion: 1,
  status: "idle",
  accumulatedMs: 0,
  runningSince: null,
  sessionStartedAt: null,
});

export const getStopwatchElapsedMs = (state: IStopwatchState, now: number): number =>
  state.status === "running" && state.runningSince !== null
    ? Math.max(0, state.accumulatedMs + now - state.runningSince)
    : Math.max(0, state.accumulatedMs);

export const startStopwatch = (state: IStopwatchState, now: number): IStopwatchState => {
  if (state.status === "running") return state;
  return {
    ...state,
    status: "running",
    runningSince: now,
    sessionStartedAt: state.sessionStartedAt ?? now,
  };
};

export const pauseStopwatch = (state: IStopwatchState, now: number): IStopwatchState => {
  if (state.status !== "running") return state;
  return {
    ...state,
    status: "paused",
    accumulatedMs: getStopwatchElapsedMs(state, now),
    runningSince: null,
  };
};

export const discardStopwatch = (): IStopwatchState => createStopwatchState();

export const finishStopwatch = (state: IStopwatchState, now: number, id: string): IStopwatchFinishResult | null => {
  if (state.status === "idle" || state.sessionStartedAt === null) return null;
  const durationMs = getStopwatchElapsedMs(state, now);
  return {
    state: createStopwatchState(),
    entry: {
      id,
      startedAt: state.sessionStartedAt,
      endedAt: Math.max(now, state.sessionStartedAt),
      durationMs,
    },
  };
};

export const formatStopwatchElapsed = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};

export const formatStopwatchCompact = (elapsedMs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 100) return `${hours}h`;
  if (hours > 0) return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
};
