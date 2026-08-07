import { createStopwatchState, STOPWATCH_HISTORY_STORAGE_KEY, STOPWATCH_STORAGE_KEY } from "./model";
import type { IStopwatchHistory, IStopwatchHistoryEntry, IStopwatchState, StopwatchStatus } from "./types";

const STATUSES: StopwatchStatus[] = ["idle", "running", "paused"];
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_STOPWATCH_DURATION_MS = 365 * 24 * 60 * 60 * 1_000;
export const MAX_STOPWATCH_HISTORY_ENTRIES = 500;

const isSafeTimestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const clampDuration = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_STOPWATCH_DURATION_MS, Math.max(0, Math.round(value)))
    : 0;

export const normalizeStopwatchState = (value: unknown, now = Date.now()): IStopwatchState => {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return createStopwatchState();
  const candidate = value as Partial<IStopwatchState>;
  const status = STATUSES.includes(candidate.status as StopwatchStatus) ? candidate.status as StopwatchStatus : "idle";
  const accumulatedMs = clampDuration(candidate.accumulatedMs);
  const sessionStartedAt = isSafeTimestamp(candidate.sessionStartedAt) && candidate.sessionStartedAt <= now
    ? candidate.sessionStartedAt
    : null;
  const runningSince = isSafeTimestamp(candidate.runningSince) && candidate.runningSince <= now
    ? candidate.runningSince
    : null;

  if (status === "idle" || sessionStartedAt === null) return createStopwatchState();
  if (status === "running" && runningSince !== null && runningSince >= sessionStartedAt) {
    return { schemaVersion: 1, status, accumulatedMs, runningSince, sessionStartedAt };
  }
  return { schemaVersion: 1, status: "paused", accumulatedMs, runningSince: null, sessionStartedAt };
};

const normalizeHistoryEntry = (value: unknown, now: number): IStopwatchHistoryEntry | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IStopwatchHistoryEntry>;
  if (typeof candidate.id !== "string" || !candidate.id || candidate.id.length > 200) return null;
  if (!isSafeTimestamp(candidate.startedAt) || !isSafeTimestamp(candidate.endedAt) || candidate.endedAt < candidate.startedAt || candidate.endedAt > now + MAX_CLOCK_SKEW_MS) return null;
  const durationMs = clampDuration(candidate.durationMs);
  return { id: candidate.id, startedAt: candidate.startedAt, endedAt: candidate.endedAt, durationMs };
};

export const normalizeStopwatchHistory = (value: unknown, now = Date.now()): IStopwatchHistory => {
  if (!value || typeof value !== "object" || (value as { schemaVersion?: unknown }).schemaVersion !== 1) return { schemaVersion: 1, entries: [] };
  const rawEntries = Array.isArray((value as Partial<IStopwatchHistory>).entries) ? (value as Partial<IStopwatchHistory>).entries ?? [] : [];
  const seen = new Set<string>();
  const entries = rawEntries
    .map((entry) => normalizeHistoryEntry(entry, now))
    .filter((entry): entry is IStopwatchHistoryEntry => entry !== null)
    .sort((left, right) => right.endedAt - left.endedAt)
    .filter((entry) => {
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .slice(0, MAX_STOPWATCH_HISTORY_ENTRIES);
  return { schemaVersion: 1, entries };
};

export const readStopwatchState = (): IStopwatchState => {
  try {
    const raw = window.localStorage.getItem(STOPWATCH_STORAGE_KEY);
    return raw ? normalizeStopwatchState(JSON.parse(raw)) : createStopwatchState();
  } catch {
    return createStopwatchState();
  }
};

export const writeStopwatchState = (state: IStopwatchState): void => {
  try {
    window.localStorage.setItem(STOPWATCH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Runtime state remains authoritative when storage is unavailable.
  }
};

export const readStopwatchHistory = (): IStopwatchHistory => {
  try {
    const raw = window.localStorage.getItem(STOPWATCH_HISTORY_STORAGE_KEY);
    return raw ? normalizeStopwatchHistory(JSON.parse(raw)) : { schemaVersion: 1, entries: [] };
  } catch {
    return { schemaVersion: 1, entries: [] };
  }
};

export const writeStopwatchHistory = (history: IStopwatchHistory): void => {
  try {
    window.localStorage.setItem(STOPWATCH_HISTORY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Runtime history remains authoritative when storage is unavailable.
  }
};
