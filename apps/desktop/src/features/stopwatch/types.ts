export type StopwatchStatus = "idle" | "running" | "paused";

export interface IStopwatchState {
  schemaVersion: 1;
  status: StopwatchStatus;
  accumulatedMs: number;
  runningSince: number | null;
  sessionStartedAt: number | null;
}

export interface IStopwatchHistoryEntry {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export interface IStopwatchHistory {
  schemaVersion: 1;
  entries: IStopwatchHistoryEntry[];
}

export interface IStopwatchFinishResult {
  state: IStopwatchState;
  entry: IStopwatchHistoryEntry;
}

export interface IStopwatchView {
  state: IStopwatchState;
  history: IStopwatchHistoryEntry[];
  elapsedMs: number;
  elapsedLabel: string;
  compactElapsedLabel: string;
}
