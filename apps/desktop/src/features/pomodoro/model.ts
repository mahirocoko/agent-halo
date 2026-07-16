import type { IPomodoroCompletion, IPomodoroSettings, IPomodoroState, PomodoroPhase } from "./types";

export const POMODORO_STORAGE_KEY = "agent-halo.pomodoro";
export const POMODORO_SETTINGS_STORAGE_KEY = "agent-halo.pomodoro-settings";
export const POMODORO_NOTIFICATION_ID = "agent-halo.pomodoro";
export const POMODORO_COMPLETION_SIGNAL_MS = 10_000;
export const POMODORO_LONG_BREAK_EVERY = 4;
export const DEFAULT_POMODORO_SETTINGS: IPomodoroSettings = {
  schemaVersion: 1,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: POMODORO_LONG_BREAK_EVERY,
};

export const getPomodoroPhaseDuration = (phase: PomodoroPhase, settings = DEFAULT_POMODORO_SETTINGS): number => {
  if (phase === "focus") return settings.focusMinutes * 60 * 1_000;
  if (phase === "long-break") return settings.longBreakMinutes * 60 * 1_000;
  return settings.shortBreakMinutes * 60 * 1_000;
};

export const getPomodoroPhaseLabel = (phase: PomodoroPhase): string => {
  if (phase === "focus") return "Focus";
  if (phase === "long-break") return "Long break";
  return "Short break";
};

export const getPomodoroNextPhase = (
  phase: PomodoroPhase,
  completedFocusSessions: number,
  completedNaturally: boolean,
  longBreakEvery = POMODORO_LONG_BREAK_EVERY,
): PomodoroPhase => {
  if (phase !== "focus") return "focus";
  const nextCompletedCount = completedFocusSessions + (completedNaturally ? 1 : 0);
  return completedNaturally && nextCompletedCount > 0 && nextCompletedCount % longBreakEvery === 0
    ? "long-break"
    : "short-break";
};

export const createPomodoroState = (settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState => ({
  schemaVersion: 2,
  phase: "focus",
  status: "idle",
  completedFocusSessions: 0,
  phaseDurationMs: getPomodoroPhaseDuration("focus", settings),
  remainingMs: getPomodoroPhaseDuration("focus", settings),
  endsAt: null,
  runId: null,
  notificationScheduled: false,
  lastCompletion: null,
});

export const getPomodoroRemainingMs = (state: IPomodoroState, now: number): number =>
  state.status === "running" && state.endsAt !== null
    ? Math.max(0, state.endsAt - now)
    : Math.max(0, state.remainingMs);

export const startPomodoro = (state: IPomodoroState, now: number, runId: string): IPomodoroState => {
  const remainingMs = state.remainingMs > 0 ? state.remainingMs : state.phaseDurationMs;
  return {
    ...state,
    status: "running",
    remainingMs,
    endsAt: now + remainingMs,
    runId: state.runId ?? runId,
    notificationScheduled: false,
    lastCompletion: null,
  };
};

export const pausePomodoro = (state: IPomodoroState, now: number): IPomodoroState => ({
  ...state,
  status: "paused",
  remainingMs: getPomodoroRemainingMs(state, now),
  endsAt: null,
  notificationScheduled: false,
});

export const resetPomodoro = (state: IPomodoroState, settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState => ({
  ...state,
  status: "idle",
  phaseDurationMs: getPomodoroPhaseDuration(state.phase, settings),
  remainingMs: getPomodoroPhaseDuration(state.phase, settings),
  endsAt: null,
  runId: null,
  notificationScheduled: false,
  lastCompletion: null,
});

export const skipPomodoro = (state: IPomodoroState, settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState => {
  const nextPhase = getPomodoroNextPhase(state.phase, state.completedFocusSessions, false, settings.longBreakEvery);
  return {
    ...state,
    phase: nextPhase,
    status: "idle",
    phaseDurationMs: getPomodoroPhaseDuration(nextPhase, settings),
    remainingMs: getPomodoroPhaseDuration(nextPhase, settings),
    endsAt: null,
    runId: null,
    notificationScheduled: false,
    lastCompletion: null,
  };
};

export const completePomodoro = (state: IPomodoroState, completedAt: number, observedAt = completedAt, settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState => {
  if (state.status !== "running") return state;
  const nextPhase = getPomodoroNextPhase(state.phase, state.completedFocusSessions, true, settings.longBreakEvery);
  const completedFocusSessions = state.completedFocusSessions + (state.phase === "focus" ? 1 : 0);
  const completion: IPomodoroCompletion = {
    id: state.runId ?? `completed-${completedAt}`,
    completedAt,
    observedAt,
    completedPhase: state.phase,
    nextPhase,
    notificationScheduled: state.notificationScheduled,
  };
  return {
    ...state,
    phase: nextPhase,
    status: "idle",
    completedFocusSessions,
    phaseDurationMs: getPomodoroPhaseDuration(nextPhase, settings),
    remainingMs: getPomodoroPhaseDuration(nextPhase, settings),
    endsAt: null,
    runId: null,
    notificationScheduled: false,
    lastCompletion: completion,
  };
};

export const reconcilePomodoro = (state: IPomodoroState, now: number, settings = DEFAULT_POMODORO_SETTINGS): IPomodoroState =>
  state.status === "running" && state.endsAt !== null && state.endsAt <= now
    ? completePomodoro(state, state.endsAt, now, settings)
    : state;

export const applyPomodoroSettings = (state: IPomodoroState, settings: IPomodoroSettings): IPomodoroState => {
  if (state.status !== "idle") return state;
  const phaseDurationMs = getPomodoroPhaseDuration(state.phase, settings);
  return { ...state, phaseDurationMs, remainingMs: phaseDurationMs };
};

export const formatPomodoroCountdown = (remainingMs: number): string => {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export const getPomodoroNotificationCopy = (state: IPomodoroState, settings = DEFAULT_POMODORO_SETTINGS): { title: string; body: string } => {
  if (state.phase === "focus") {
    const nextPhase = getPomodoroNextPhase(state.phase, state.completedFocusSessions, true, settings.longBreakEvery);
    return {
      title: "Focus complete",
      body: nextPhase === "long-break" ? "Long break ready" : "Short break ready",
    };
  }
  return { title: "Break complete", body: "Ready for the next focus session" };
};
