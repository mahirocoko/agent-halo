export type PomodoroPhase = "focus" | "short-break" | "long-break";
export type PomodoroStatus = "idle" | "running" | "paused";
export type PomodoroNotificationPermission = "notDetermined" | "denied" | "authorized" | "provisional" | "ephemeral" | "unsupported";

export interface IPomodoroSettings {
  schemaVersion: 1;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
}

export interface IPomodoroCompletion {
  id: string;
  completedAt: number;
  observedAt: number;
  completedPhase: PomodoroPhase;
  nextPhase: PomodoroPhase;
  notificationScheduled: boolean;
}

export interface IPomodoroState {
  schemaVersion: 2;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  completedFocusSessions: number;
  phaseDurationMs: number;
  remainingMs: number;
  endsAt: number | null;
  runId: string | null;
  notificationScheduled: boolean;
  lastCompletion: IPomodoroCompletion | null;
}

export interface IPomodoroView {
  state: IPomodoroState;
  settings: IPomodoroSettings;
  remainingMs: number;
  durationMs: number;
  progress: number;
  phaseLabel: string;
  nextPhaseLabel: string;
  countdownLabel: string;
  cyclePosition: number;
  completionVisible: boolean;
  notificationPermission: PomodoroNotificationPermission;
  notificationError: string | null;
}
