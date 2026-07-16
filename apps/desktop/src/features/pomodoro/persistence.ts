import { createPomodoroState, DEFAULT_POMODORO_SETTINGS, getPomodoroPhaseDuration, POMODORO_SETTINGS_STORAGE_KEY, POMODORO_STORAGE_KEY, reconcilePomodoro } from "./model";
import type { IPomodoroCompletion, IPomodoroSettings, IPomodoroState, PomodoroPhase, PomodoroStatus } from "./types";

const PHASES: PomodoroPhase[] = ["focus", "short-break", "long-break"];
const STATUSES: PomodoroStatus[] = ["idle", "running", "paused"];
const MAX_COMPLETED_FOCUS_SESSIONS = 1_000_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const MAX_PHASE_DURATION_MS = 120 * 60 * 1_000;

const isSafeTimestamp = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const readCompletion = (value: unknown, now: number): IPomodoroCompletion | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<IPomodoroCompletion>;
  if (typeof candidate.id !== "string" || !candidate.id) return null;
  if (!isSafeTimestamp(candidate.completedAt) || !isSafeTimestamp(candidate.observedAt) || candidate.observedAt > now + MAX_CLOCK_SKEW_MS || !PHASES.includes(candidate.completedPhase as PomodoroPhase) || !PHASES.includes(candidate.nextPhase as PomodoroPhase)) return null;
  return {
    id: candidate.id,
    completedAt: candidate.completedAt,
    observedAt: candidate.observedAt,
    completedPhase: candidate.completedPhase as PomodoroPhase,
    nextPhase: candidate.nextPhase as PomodoroPhase,
    notificationScheduled: candidate.notificationScheduled === true,
  };
};

const clampInteger = (value: unknown, minimum: number, maximum: number, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;

export const normalizePomodoroSettings = (value: unknown): IPomodoroSettings => {
  if (!value || typeof value !== "object") return { ...DEFAULT_POMODORO_SETTINGS };
  const candidate = value as Partial<IPomodoroSettings>;
  return {
    schemaVersion: 1,
    focusMinutes: clampInteger(candidate.focusMinutes, 1, 120, DEFAULT_POMODORO_SETTINGS.focusMinutes),
    shortBreakMinutes: clampInteger(candidate.shortBreakMinutes, 1, 60, DEFAULT_POMODORO_SETTINGS.shortBreakMinutes),
    longBreakMinutes: clampInteger(candidate.longBreakMinutes, 1, 120, DEFAULT_POMODORO_SETTINGS.longBreakMinutes),
    longBreakEvery: clampInteger(candidate.longBreakEvery, 2, 12, DEFAULT_POMODORO_SETTINGS.longBreakEvery),
  };
};

export const normalizePomodoroState = (value: unknown, now = Date.now(), settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState => {
  if (!value || typeof value !== "object") return createPomodoroState(settings);
  const candidate = value as Partial<IPomodoroState>;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2) return createPomodoroState(settings);
  const phase = PHASES.includes(candidate.phase as PomodoroPhase) ? candidate.phase as PomodoroPhase : "focus";
  const status = STATUSES.includes(candidate.status as PomodoroStatus) ? candidate.status as PomodoroStatus : "idle";
  const configuredDurationMs = getPomodoroPhaseDuration(phase, settings);
  const phaseDurationMs = schemaVersion === 2 && typeof candidate.phaseDurationMs === "number" && Number.isFinite(candidate.phaseDurationMs)
    ? Math.min(MAX_PHASE_DURATION_MS, Math.max(60_000, candidate.phaseDurationMs))
    : configuredDurationMs;
  const state: IPomodoroState = {
    schemaVersion: 2,
    phase,
    status,
    completedFocusSessions: typeof candidate.completedFocusSessions === "number" && Number.isSafeInteger(candidate.completedFocusSessions) ? Math.min(MAX_COMPLETED_FOCUS_SESSIONS, Math.max(0, candidate.completedFocusSessions)) : 0,
    phaseDurationMs,
    remainingMs: typeof candidate.remainingMs === "number" && Number.isFinite(candidate.remainingMs) ? Math.min(phaseDurationMs, Math.max(0, candidate.remainingMs)) : phaseDurationMs,
    endsAt: status === "running" && isSafeTimestamp(candidate.endsAt) ? candidate.endsAt : null,
    runId: typeof candidate.runId === "string" && candidate.runId ? candidate.runId : null,
    notificationScheduled: candidate.notificationScheduled === true,
    lastCompletion: readCompletion(candidate.lastCompletion, now),
  };
  if (state.status === "running" && (state.endsAt === null || state.runId === null)) return resetInvalidRunningState(state, settings);
  if (state.status === "running" && state.endsAt !== null && state.endsAt > now + phaseDurationMs + MAX_CLOCK_SKEW_MS) return resetInvalidRunningState(state, settings);
  return reconcilePomodoro(state, now, settings);
};

const resetInvalidRunningState = (state: IPomodoroState, settings: IPomodoroSettings): IPomodoroState => ({
  ...state,
  status: "idle",
  phaseDurationMs: getPomodoroPhaseDuration(state.phase, settings),
  remainingMs: getPomodoroPhaseDuration(state.phase, settings),
  endsAt: null,
  runId: null,
  notificationScheduled: false,
});

export const readPomodoroSettings = (): IPomodoroSettings => {
  try {
    const raw = window.localStorage.getItem(POMODORO_SETTINGS_STORAGE_KEY);
    return raw ? normalizePomodoroSettings(JSON.parse(raw)) : { ...DEFAULT_POMODORO_SETTINGS };
  } catch {
    return { ...DEFAULT_POMODORO_SETTINGS };
  }
};

export const writePomodoroSettings = (settings: IPomodoroSettings): void => {
  try {
    window.localStorage.setItem(POMODORO_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Runtime settings remain authoritative when storage is unavailable.
  }
};

export const readPomodoroState = (settings = readPomodoroSettings()): IPomodoroState => {
  try {
    const raw = window.localStorage.getItem(POMODORO_STORAGE_KEY);
    return raw ? normalizePomodoroState(JSON.parse(raw), Date.now(), settings) : createPomodoroState(settings);
  } catch {
    return createPomodoroState(settings);
  }
};

export const writePomodoroState = (state: IPomodoroState): void => {
  try {
    window.localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Runtime state remains authoritative when storage is unavailable.
  }
};
