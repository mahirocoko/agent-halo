import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyPomodoroSettings,
  formatPomodoroCountdown,
  getPomodoroNextPhase,
  getPomodoroNotificationCopy,
  getPomodoroPhaseLabel,
  getPomodoroRemainingMs,
  pausePomodoro,
  POMODORO_COMPLETION_SIGNAL_MS,
  POMODORO_NOTIFICATION_ID,
  POMODORO_PET_FALLBACK_DELAY_MS,
  reconcilePomodoro,
  resetPomodoro,
  resetAllPomodoro,
  skipPomodoro,
  startPomodoro,
} from "./model";
import { normalizePomodoroSettings, readPomodoroSettings, readPomodoroState, writePomodoroSettings, writePomodoroState } from "./persistence";
import type { IPomodoroSettings, IPomodoroState, IPomodoroView, PomodoroNotificationPermission } from "./types";

const NOTIFICATION_ALLOWED: PomodoroNotificationPermission[] = ["authorized", "provisional", "ephemeral"];

const createRunId = (): string => {
  try { return crypto.randomUUID(); } catch { return `pomodoro-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
};

export interface IUsePomodoroResult extends IPomodoroView {
  start: () => void;
  pause: () => void;
  reset: () => void;
  resetAll: () => void;
  skip: () => void;
  updateSettings: (settings: IPomodoroSettings) => void;
  resolveCompletionWithPet: (handoffDeadlineMs: number) => Promise<boolean>;
  restoreCompletionNotificationFallback: (completionId: string) => Promise<boolean>;
}

export const usePomodoro = (canUseNativeNotifications: boolean, preferCompletionPet = false): IUsePomodoroResult => {
  const [settings, setSettings] = useState<IPomodoroSettings>(readPomodoroSettings);
  const [state, setState] = useState<IPomodoroState>(() => readPomodoroState(settings));
  const [now, setNow] = useState(Date.now);
  const [notificationPermission, setNotificationPermission] = useState<PomodoroNotificationPermission>(canUseNativeNotifications ? "notDetermined" : "unsupported");
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const nativeRequestVersionRef = useRef(0);
  const nativeOperationRef = useRef<Promise<void>>(Promise.resolve());
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const previousPetPreferenceRef = useRef(preferCompletionPet);

  const notificationDeadline = (deadlineMs: number, phase: IPomodoroState["phase"]): number =>
    deadlineMs + (preferCompletionPet && phase === "focus" ? POMODORO_PET_FALLBACK_DELAY_MS : 0);

  const commitState = (next: IPomodoroState): void => {
    stateRef.current = next;
    setState(next);
  };

  const enqueueNativeOperation = (operation: () => Promise<void>): void => {
    const queued = nativeOperationRef.current.catch(() => undefined).then(operation);
    nativeOperationRef.current = queued.catch(() => undefined);
  };

  useEffect(() => {
    stateRef.current = state;
    writePomodoroState(state);
  }, [state]);

  useEffect(() => {
    settingsRef.current = settings;
    writePomodoroSettings(settings);
  }, [settings]);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 500);
    const handleVisibility = () => tick();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!canUseNativeNotifications) {
      setNotificationPermission("unsupported");
      return;
    }
    let cancelled = false;
    const requestVersion = nativeRequestVersionRef.current;
    enqueueNativeOperation(async () => {
      try {
        const permission = await invoke<PomodoroNotificationPermission>("notification_permission_state");
        if (cancelled || nativeRequestVersionRef.current !== requestVersion) return;
        setNotificationPermission(permission);
        const restored = stateRef.current;
        if (restored.status !== "running" || restored.endsAt === null || restored.endsAt <= Date.now()) {
          const completion = restored.lastCompletion;
          const keepPendingPetFallback = preferCompletionPet
            && completion?.completedPhase === "focus"
            && completion.notificationScheduled
            && Date.now() < completion.completedAt + POMODORO_PET_FALLBACK_DELAY_MS;
          if (keepPendingPetFallback) return;
          await invoke("cancel_pomodoro_notification", { requestId: POMODORO_NOTIFICATION_ID });
          return;
        }
        if (!NOTIFICATION_ALLOWED.includes(permission)) return;
        const copy = getPomodoroNotificationCopy(restored, settingsRef.current);
        await invoke("schedule_pomodoro_notification", {
          requestId: POMODORO_NOTIFICATION_ID,
          deadlineMs: notificationDeadline(restored.endsAt, restored.phase),
          title: copy.title,
          body: copy.body,
        });
        if (cancelled || nativeRequestVersionRef.current !== requestVersion) return;
        const current = stateRef.current;
        if (current.runId === restored.runId && current.status === "running") {
          commitState({ ...current, notificationScheduled: true });
        }
      } catch {
        if (!cancelled && nativeRequestVersionRef.current === requestVersion) setNotificationPermission("unsupported");
      }
    });
    return () => { cancelled = true; };
  }, [canUseNativeNotifications]);

  useEffect(() => {
    if (state.status !== "running" || state.endsAt === null || state.endsAt > now) return;
    commitState(reconcilePomodoro(stateRef.current, now, settingsRef.current));
  }, [now, state.endsAt, state.status]);

  const enqueueNativeCancel = (): void => {
    if (!canUseNativeNotifications) return;
    enqueueNativeOperation(async () => {
      await invoke("cancel_pomodoro_notification", { requestId: POMODORO_NOTIFICATION_ID });
    });
  };

  const start = (): void => {
    const current = stateRef.current;
    if (current.status === "running") return;
    const requestVersion = nativeRequestVersionRef.current + 1;
    nativeRequestVersionRef.current = requestVersion;
    const started = startPomodoro(current, Date.now(), createRunId());
    commitState(started);
    if (!canUseNativeNotifications || started.endsAt === null || started.runId === null) return;
    const notificationDeadlineMs = notificationDeadline(started.endsAt, started.phase);
    enqueueNativeOperation(async () => {
      try {
        await invoke("cancel_pomodoro_notification", { requestId: POMODORO_NOTIFICATION_ID });
        if (nativeRequestVersionRef.current !== requestVersion) return;
        let permission = await invoke<PomodoroNotificationPermission>("notification_permission_state");
        if (nativeRequestVersionRef.current !== requestVersion) return;
        if (permission === "notDetermined") {
          permission = await invoke<PomodoroNotificationPermission>("request_notification_permission");
        }
        if (nativeRequestVersionRef.current !== requestVersion) return;
        setNotificationPermission(permission);
        if (!NOTIFICATION_ALLOWED.includes(permission)) {
          setNotificationError(permission === "denied" ? "Notifications are disabled in macOS Settings" : "Native notifications unavailable");
          return;
        }
        const copy = getPomodoroNotificationCopy(started, settingsRef.current);
        await invoke("schedule_pomodoro_notification", {
          requestId: POMODORO_NOTIFICATION_ID,
          deadlineMs: notificationDeadlineMs,
          title: copy.title,
          body: copy.body,
        });
        if (nativeRequestVersionRef.current !== requestVersion) return;
        setNotificationError(null);
        const latest = stateRef.current;
        if (latest.runId === started.runId && latest.status === "running") {
          commitState({ ...latest, notificationScheduled: true });
        }
      } catch (error) {
        if (nativeRequestVersionRef.current !== requestVersion) return;
        setNotificationError(error instanceof Error ? error.message : "Could not schedule macOS notification");
      }
    });
  };

  const pause = (): void => {
    const actionAt = Date.now();
    nativeRequestVersionRef.current += 1;
    enqueueNativeCancel();
    const current = stateRef.current;
    const reconciled = reconcilePomodoro(current, actionAt, settingsRef.current);
    commitState(reconciled !== current ? reconciled : current.status === "running" ? pausePomodoro(current, actionAt) : current);
  };

  const reset = (): void => {
    const actionAt = Date.now();
    nativeRequestVersionRef.current += 1;
    enqueueNativeCancel();
    commitState(resetPomodoro(reconcilePomodoro(stateRef.current, actionAt, settingsRef.current), settingsRef.current));
  };

  const resetAll = (): void => {
    nativeRequestVersionRef.current += 1;
    enqueueNativeCancel();
    setNotificationError(null);
    commitState(resetAllPomodoro(settingsRef.current));
  };

  const skip = (): void => {
    const actionAt = Date.now();
    nativeRequestVersionRef.current += 1;
    enqueueNativeCancel();
    commitState(skipPomodoro(reconcilePomodoro(stateRef.current, actionAt, settingsRef.current), settingsRef.current));
  };

  const updateSettings = (nextSettings: IPomodoroSettings): void => {
    const normalized = normalizePomodoroSettings(nextSettings);
    settingsRef.current = normalized;
    setSettings(normalized);
    const current = applyPomodoroSettings(stateRef.current, normalized);
    commitState(current);
    if (!canUseNativeNotifications || current.status !== "running" || current.endsAt === null || current.runId === null) return;
    const notificationDeadlineMs = notificationDeadline(current.endsAt, current.phase);
    const requestVersion = nativeRequestVersionRef.current + 1;
    nativeRequestVersionRef.current = requestVersion;
    enqueueNativeOperation(async () => {
      try {
        const permission = await invoke<PomodoroNotificationPermission>("notification_permission_state");
        if (nativeRequestVersionRef.current !== requestVersion || !NOTIFICATION_ALLOWED.includes(permission)) return;
        const copy = getPomodoroNotificationCopy(current, normalized);
        await invoke("schedule_pomodoro_notification", {
          requestId: POMODORO_NOTIFICATION_ID,
          deadlineMs: notificationDeadlineMs,
          title: copy.title,
          body: copy.body,
        });
        if (nativeRequestVersionRef.current !== requestVersion) return;
        const latest = stateRef.current;
        if (latest.runId === current.runId && latest.status === "running") commitState({ ...latest, notificationScheduled: true });
      } catch (error) {
        if (nativeRequestVersionRef.current === requestVersion) setNotificationError(error instanceof Error ? error.message : "Could not update macOS notification");
      }
    });
  };

  useEffect(() => {
    if (previousPetPreferenceRef.current === preferCompletionPet) return;
    previousPetPreferenceRef.current = preferCompletionPet;
    const current = stateRef.current;
    if (!canUseNativeNotifications || current.status !== "running" || current.endsAt === null || current.runId === null) return;
    const actionAt = Date.now();
    if (current.endsAt <= actionAt) {
      commitState(reconcilePomodoro(current, actionAt, settingsRef.current));
      return;
    }
    const notificationDeadlineMs = notificationDeadline(current.endsAt, current.phase);
    const requestVersion = nativeRequestVersionRef.current + 1;
    nativeRequestVersionRef.current = requestVersion;
    enqueueNativeOperation(async () => {
      try {
        await invoke("cancel_pomodoro_notification", { requestId: POMODORO_NOTIFICATION_ID });
        if (nativeRequestVersionRef.current !== requestVersion) return;
        let permission = await invoke<PomodoroNotificationPermission>("notification_permission_state");
        if (permission === "notDetermined") permission = await invoke<PomodoroNotificationPermission>("request_notification_permission");
        if (nativeRequestVersionRef.current !== requestVersion || !NOTIFICATION_ALLOWED.includes(permission)) return;
        const deadlineMs = notificationDeadlineMs;
        if (deadlineMs <= Date.now()) return;
        const copy = getPomodoroNotificationCopy(current, settingsRef.current);
        await invoke("schedule_pomodoro_notification", {
          requestId: POMODORO_NOTIFICATION_ID,
          deadlineMs,
          title: copy.title,
          body: copy.body,
        });
        if (nativeRequestVersionRef.current !== requestVersion) return;
        const latest = stateRef.current;
        if (latest.runId === current.runId && latest.status === "running") commitState({ ...latest, notificationScheduled: true });
      } catch (error) {
        if (nativeRequestVersionRef.current === requestVersion) setNotificationError(error instanceof Error ? error.message : "Could not update macOS notification");
      }
    });
  }, [canUseNativeNotifications, preferCompletionPet]);

  const resolveCompletionWithPet = async (handoffDeadlineMs: number): Promise<boolean> => {
    const requestVersion = nativeRequestVersionRef.current + 1;
    nativeRequestVersionRef.current = requestVersion;
    const current = stateRef.current;
    const completionId = current.lastCompletion?.id;
    if (!current.lastCompletion?.notificationScheduled || !canUseNativeNotifications) return true;
    const operation = nativeOperationRef.current
      .catch(() => undefined)
      .then(async () => {
        if (nativeRequestVersionRef.current !== requestVersion) return false;
        try {
          const claimed = await invoke<boolean>("cancel_pomodoro_notification", {
            requestId: POMODORO_NOTIFICATION_ID,
            handoffDeadlineMs,
          });
          if (!claimed) return false;
        } catch (error) {
          if (nativeRequestVersionRef.current === requestVersion) setNotificationError(error instanceof Error ? error.message : "Could not replace notification with Completion Pet");
          return false;
        }
        if (nativeRequestVersionRef.current !== requestVersion) return false;
        const latest = stateRef.current;
        const latestCompletion = latest.lastCompletion;
        if (latestCompletion !== null && latestCompletion.id === completionId && latestCompletion.notificationScheduled) {
          commitState({
            ...latest,
            lastCompletion: { ...latestCompletion, notificationScheduled: false },
          });
        }
        return true;
      });
    nativeOperationRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const restoreCompletionNotificationFallback = async (completionId: string): Promise<boolean> => {
    if (!canUseNativeNotifications) return false;
    const requestVersion = nativeRequestVersionRef.current + 1;
    nativeRequestVersionRef.current = requestVersion;
    const operation = nativeOperationRef.current
      .catch(() => undefined)
      .then(async () => {
        const current = stateRef.current;
        const completion = current.lastCompletion;
        if (nativeRequestVersionRef.current !== requestVersion || completion?.id !== completionId) return false;
        try {
          const permission = await invoke<PomodoroNotificationPermission>("notification_permission_state");
          if (!NOTIFICATION_ALLOWED.includes(permission)) return false;
          await invoke("schedule_pomodoro_notification", {
            requestId: POMODORO_NOTIFICATION_ID,
            deadlineMs: Date.now() + 2_000,
            title: completion.completedPhase === "focus" ? "Focus complete" : "Break complete",
            body: `${getPomodoroPhaseLabel(completion.nextPhase)} ready`,
          });
        } catch (error) {
          if (nativeRequestVersionRef.current === requestVersion) setNotificationError(error instanceof Error ? error.message : "Could not restore Completion Pet notification fallback");
          return false;
        }
        if (nativeRequestVersionRef.current !== requestVersion) return false;
        const latest = stateRef.current;
        const latestCompletion = latest.lastCompletion;
        if (latestCompletion?.id === completionId) {
          commitState({ ...latest, lastCompletion: { ...latestCompletion, notificationScheduled: true } });
        }
        return true;
      });
    nativeOperationRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const remainingMs = getPomodoroRemainingMs(state, now);
  const durationMs = state.phaseDurationMs;
  const nextPhase = getPomodoroNextPhase(state.phase, state.completedFocusSessions, true, settings.longBreakEvery);
  const view = useMemo<IPomodoroView>(() => ({
    state,
    settings,
    remainingMs,
    durationMs,
    progress: Math.min(1, Math.max(0, 1 - remainingMs / durationMs)),
    phaseLabel: getPomodoroPhaseLabel(state.phase),
    nextPhaseLabel: getPomodoroPhaseLabel(nextPhase),
    countdownLabel: formatPomodoroCountdown(remainingMs),
    cyclePosition: state.phase === "long-break" ? settings.longBreakEvery : state.completedFocusSessions % settings.longBreakEvery,
    completionVisible: state.lastCompletion !== null && now >= state.lastCompletion.observedAt && now - state.lastCompletion.observedAt <= POMODORO_COMPLETION_SIGNAL_MS,
    notificationPermission,
    notificationError,
  }), [durationMs, nextPhase, notificationError, notificationPermission, now, remainingMs, settings, state]);

  return { ...view, start, pause, reset, resetAll, skip, updateSettings, resolveCompletionWithPet, restoreCompletionNotificationFallback };
};
