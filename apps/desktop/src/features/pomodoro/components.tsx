import { Bell, BellOff, ChevronDown, Pause, Play, RotateCcw, SkipForward, SlidersHorizontal, Timer } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { DEFAULT_POMODORO_SETTINGS, getPomodoroPhaseLabel } from "./model";
import type { IPomodoroSettings } from "./types";
import type { IUsePomodoroResult } from "./usePomodoro";

export interface IPomodoroPanelProps {
  pomodoro: IUsePomodoroResult;
}

type PomodoroSettingKey = keyof Omit<IPomodoroSettings, "schemaVersion">;
type PomodoroSettingsDraft = Record<PomodoroSettingKey, string>;

const toSettingsDraft = (settings: IPomodoroSettings): PomodoroSettingsDraft => ({
  focusMinutes: `${settings.focusMinutes}`,
  shortBreakMinutes: `${settings.shortBreakMinutes}`,
  longBreakMinutes: `${settings.longBreakMinutes}`,
  longBreakEvery: `${settings.longBreakEvery}`,
});

const validateSetting = (value: string, minimum: number, maximum: number): string | null => {
  const parsed = Number(value);
  if (!value.trim() || !Number.isInteger(parsed)) return "Whole number required";
  if (parsed < minimum || parsed > maximum) return `${minimum}–${maximum}`;
  return null;
};

export const PomodoroPanel = ({ pomodoro }: IPomodoroPanelProps) => {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<PomodoroSettingsDraft>(() => toSettingsDraft(pomodoro.settings));
  const { state } = pomodoro;
  const running = state.status === "running";
  const paused = state.status === "paused";
  const statusLabel = running ? "Running" : paused ? "Paused" : pomodoro.completionVisible ? `${getPomodoroPhaseLabel(state.lastCompletion?.completedPhase ?? state.phase)} complete` : "Ready";
  const notificationAvailable = pomodoro.notificationPermission !== "unsupported" && pomodoro.notificationPermission !== "denied";
  const showNotificationNote = pomodoro.notificationError !== null || ["notDetermined", "denied", "unsupported"].includes(pomodoro.notificationPermission);
  const resetDisabled = state.status === "idle" && pomodoro.remainingMs === pomodoro.durationMs && state.lastCompletion === null;
  const progressStyle = { "--pomodoro-progress": `${pomodoro.progress * 100}%` } as CSSProperties;
  const settingsErrors = {
    focusMinutes: validateSetting(settingsDraft.focusMinutes, 1, 120),
    shortBreakMinutes: validateSetting(settingsDraft.shortBreakMinutes, 1, 60),
    longBreakMinutes: validateSetting(settingsDraft.longBreakMinutes, 1, 120),
    longBreakEvery: validateSetting(settingsDraft.longBreakEvery, 2, 12),
  };
  const settingsValid = Object.values(settingsErrors).every((error) => error === null);

  useEffect(() => {
    if (settingsOpen) setSettingsDraft(toSettingsDraft(pomodoro.settings));
  }, [pomodoro.settings, settingsOpen]);

  const updateDraft = (field: PomodoroSettingKey, value: string): void => {
    setSettingsDraft((current) => ({ ...current, [field]: value }));
  };

  const applySettings = (): void => {
    if (!settingsValid) return;
    pomodoro.updateSettings({
      schemaVersion: 1,
      focusMinutes: Number(settingsDraft.focusMinutes),
      shortBreakMinutes: Number(settingsDraft.shortBreakMinutes),
      longBreakMinutes: Number(settingsDraft.longBreakMinutes),
      longBreakEvery: Number(settingsDraft.longBreakEvery),
    });
    setSettingsOpen(false);
  };

  const restoreDefaults = (): void => {
    setSettingsDraft(toSettingsDraft(DEFAULT_POMODORO_SETTINGS));
  };

  return (
    <div className="pomodoro-panel" data-phase={state.phase} data-status={state.status}>
      <div className="pomodoro-phase-line">
        <span className="pomodoro-phase-icon" aria-hidden="true"><Timer size={13} strokeWidth={2.3} /></span>
        <span className="pomodoro-phase-label">{pomodoro.phaseLabel}</span>
        <span className="pomodoro-status" data-status={state.status}>{statusLabel}</span>
      </div>

      <div className="pomodoro-clock" role="timer" aria-label={`${pomodoro.phaseLabel}, ${pomodoro.countdownLabel} remaining`}>
        <span className="pomodoro-time">{pomodoro.countdownLabel}</span>
        <span className="pomodoro-next">Next · {pomodoro.nextPhaseLabel}</span>
      </div>

      <div className="pomodoro-progress" role="progressbar" aria-label={`${pomodoro.phaseLabel} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pomodoro.progress * 100)} style={progressStyle}>
        <span className="pomodoro-progress-fill" />
      </div>

      <div className="pomodoro-cycle-row">
        <span className="pomodoro-cycle-label">Focus cycle</span>
        <span className="pomodoro-cycle-dots" aria-label={`${pomodoro.cyclePosition} of ${pomodoro.settings.longBreakEvery} focus sessions before long break`}>
          {Array.from({ length: pomodoro.settings.longBreakEvery }, (_, index) => (
            <span className="pomodoro-cycle-dot" data-complete={index < pomodoro.cyclePosition} key={index} aria-hidden="true" />
          ))}
        </span>
        <span className="pomodoro-cycle-total">{pomodoro.cyclePosition} / {pomodoro.settings.longBreakEvery}</span>
      </div>

      <div className="pomodoro-controls">
        {running ? (
          <button className="pomodoro-control primary" type="button" onClick={pomodoro.pause} data-tauri-drag-region="false">
            <Pause size={14} strokeWidth={2.4} />Pause
          </button>
        ) : (
          <button className="pomodoro-control primary" type="button" onClick={pomodoro.start} data-tauri-drag-region="false">
            <Play size={14} strokeWidth={2.4} />{paused ? "Resume" : "Start"}
          </button>
        )}
        <button className="pomodoro-control" type="button" onClick={pomodoro.reset} disabled={resetDisabled} data-tauri-drag-region="false">
          <RotateCcw size={13} strokeWidth={2.3} />Reset
        </button>
        <button className="pomodoro-control" type="button" onClick={pomodoro.skip} data-tauri-drag-region="false">
          <SkipForward size={13} strokeWidth={2.3} />Skip
        </button>
      </div>

      <button
        className="pomodoro-settings-toggle"
        type="button"
        aria-expanded={settingsOpen}
        aria-controls="pomodoro-settings"
        onClick={() => setSettingsOpen((current) => !current)}
        data-tauri-drag-region="false"
      >
        <SlidersHorizontal size={12} strokeWidth={2.2} />
        <span>Timer settings</span>
        <span className="pomodoro-settings-summary">{pomodoro.settings.focusMinutes} / {pomodoro.settings.shortBreakMinutes} / {pomodoro.settings.longBreakMinutes} · ×{pomodoro.settings.longBreakEvery}</span>
        <ChevronDown className="pomodoro-settings-chevron" size={12} strokeWidth={2.2} />
      </button>

      {settingsOpen ? (
        <div className="pomodoro-settings" id="pomodoro-settings">
          <div className="pomodoro-settings-grid">
            <label className="pomodoro-setting-field">
              <span>Focus</span>
              <span className="pomodoro-setting-input"><input type="number" min={1} max={120} value={settingsDraft.focusMinutes} aria-invalid={settingsErrors.focusMinutes !== null} aria-describedby={settingsErrors.focusMinutes ? "pomodoro-focus-error" : undefined} onChange={(event) => updateDraft("focusMinutes", event.currentTarget.value)} data-tauri-drag-region="false" /><small>min</small></span>
              {settingsErrors.focusMinutes ? <span className="pomodoro-setting-error" id="pomodoro-focus-error">{settingsErrors.focusMinutes}</span> : null}
            </label>
            <label className="pomodoro-setting-field">
              <span>Short break</span>
              <span className="pomodoro-setting-input"><input type="number" min={1} max={60} value={settingsDraft.shortBreakMinutes} aria-invalid={settingsErrors.shortBreakMinutes !== null} aria-describedby={settingsErrors.shortBreakMinutes ? "pomodoro-short-error" : undefined} onChange={(event) => updateDraft("shortBreakMinutes", event.currentTarget.value)} data-tauri-drag-region="false" /><small>min</small></span>
              {settingsErrors.shortBreakMinutes ? <span className="pomodoro-setting-error" id="pomodoro-short-error">{settingsErrors.shortBreakMinutes}</span> : null}
            </label>
            <label className="pomodoro-setting-field">
              <span>Long break</span>
              <span className="pomodoro-setting-input"><input type="number" min={1} max={120} value={settingsDraft.longBreakMinutes} aria-invalid={settingsErrors.longBreakMinutes !== null} aria-describedby={settingsErrors.longBreakMinutes ? "pomodoro-long-error" : undefined} onChange={(event) => updateDraft("longBreakMinutes", event.currentTarget.value)} data-tauri-drag-region="false" /><small>min</small></span>
              {settingsErrors.longBreakMinutes ? <span className="pomodoro-setting-error" id="pomodoro-long-error">{settingsErrors.longBreakMinutes}</span> : null}
            </label>
            <label className="pomodoro-setting-field">
              <span>Long break every</span>
              <span className="pomodoro-setting-input"><input type="number" min={2} max={12} value={settingsDraft.longBreakEvery} aria-label="Focus sessions before long break" aria-invalid={settingsErrors.longBreakEvery !== null} aria-describedby={settingsErrors.longBreakEvery ? "pomodoro-cadence-error" : undefined} onChange={(event) => updateDraft("longBreakEvery", event.currentTarget.value)} data-tauri-drag-region="false" /><small>sessions</small></span>
              {settingsErrors.longBreakEvery ? <span className="pomodoro-setting-error" id="pomodoro-cadence-error">{settingsErrors.longBreakEvery}</span> : null}
            </label>
          </div>
          <div className="pomodoro-settings-actions">
            <span>{state.status === "idle" ? "Applies before the next Start" : "Current timer keeps its duration"}</span>
            <button type="button" onClick={restoreDefaults} data-tauri-drag-region="false">Defaults</button>
            <button className="is-primary" type="button" onClick={applySettings} disabled={!settingsValid} data-tauri-drag-region="false">Apply</button>
          </div>
        </div>
      ) : null}

      {showNotificationNote ? (
        <div className="pomodoro-notification" data-available={notificationAvailable} role="status" aria-live="polite">
          {notificationAvailable ? <Bell size={12} strokeWidth={2.2} /> : <BellOff size={12} strokeWidth={2.2} />}
          <span>{pomodoro.notificationError ?? (pomodoro.notificationPermission === "notDetermined" ? "macOS will ask for notification access when you start" : "Completion stays visible in Agent Halo")}</span>
        </div>
      ) : null}
    </div>
  );
};
