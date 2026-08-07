import { Clock3, Timer } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { PomodoroPanel } from "../pomodoro/components";
import type { IUsePomodoroResult } from "../pomodoro/usePomodoro";
import { StopwatchPanel } from "../stopwatch/components";
import type { IUseStopwatchResult } from "../stopwatch/useStopwatch";

const FOCUS_TOOL_STORAGE_KEY = "agent-halo.focus-tool";
type FocusTool = "pomodoro" | "stopwatch";

export interface IFocusToolsPanelProps {
  pomodoro: IUsePomodoroResult;
  stopwatch: IUseStopwatchResult;
  onResetAllPomodoro: () => void;
}

const readFocusTool = (stopwatch: IUseStopwatchResult): FocusTool => {
  try {
    const stored = window.localStorage.getItem(FOCUS_TOOL_STORAGE_KEY);
    if (stored === "pomodoro" || stored === "stopwatch") return stored;
  } catch {
    // Fall through to the current activity-aware default.
  }
  return stopwatch.state.status === "idle" ? "pomodoro" : "stopwatch";
};

const writeFocusTool = (tool: FocusTool): void => {
  try {
    window.localStorage.setItem(FOCUS_TOOL_STORAGE_KEY, tool);
  } catch {
    // Runtime selection remains authoritative when storage is unavailable.
  }
};

export const FocusToolsPanel = ({ onResetAllPomodoro, pomodoro, stopwatch }: IFocusToolsPanelProps) => {
  const [activeTool, setActiveTool] = useState<FocusTool>(() => readFocusTool(stopwatch));

  const selectTool = (tool: FocusTool): void => {
    setActiveTool(tool);
    writeFocusTool(tool);
  };

  const handleToolKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: FocusTool): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: FocusTool = event.key === "Home"
      ? "pomodoro"
      : event.key === "End"
        ? "stopwatch"
        : current === "pomodoro" ? "stopwatch" : "pomodoro";
    selectTool(next);
    window.requestAnimationFrame(() => document.getElementById(`focus-tool-${next}`)?.focus());
  };

  return (
    <div className="focus-tools-panel">
      <div className="focus-tool-tabs" role="tablist" aria-label="Focus tools">
        <button id="focus-tool-pomodoro" type="button" role="tab" aria-selected={activeTool === "pomodoro"} aria-controls="focus-tool-panel-pomodoro" tabIndex={activeTool === "pomodoro" ? 0 : -1} onClick={() => selectTool("pomodoro")} onKeyDown={(event) => handleToolKeyDown(event, "pomodoro")} data-tauri-drag-region="false">
          <Timer size={12} strokeWidth={2.3} />
          <span>Pomodoro</span>
          {pomodoro.state.status !== "idle" || pomodoro.completionVisible ? <small>{pomodoro.completionVisible ? "Done" : pomodoro.countdownLabel}</small> : null}
        </button>
        <button id="focus-tool-stopwatch" type="button" role="tab" aria-selected={activeTool === "stopwatch"} aria-controls="focus-tool-panel-stopwatch" tabIndex={activeTool === "stopwatch" ? 0 : -1} onClick={() => selectTool("stopwatch")} onKeyDown={(event) => handleToolKeyDown(event, "stopwatch")} data-tauri-drag-region="false">
          <Clock3 size={12} strokeWidth={2.3} />
          <span>Stopwatch</span>
          {stopwatch.state.status !== "idle" ? <small>{stopwatch.compactElapsedLabel}</small> : null}
        </button>
      </div>

      {activeTool === "pomodoro" ? (
        <div id="focus-tool-panel-pomodoro" role="tabpanel" aria-labelledby="focus-tool-pomodoro">
          <PomodoroPanel pomodoro={pomodoro} onResetAll={onResetAllPomodoro} />
        </div>
      ) : (
        <div id="focus-tool-panel-stopwatch" role="tabpanel" aria-labelledby="focus-tool-stopwatch">
          <StopwatchPanel stopwatch={stopwatch} />
        </div>
      )}
    </div>
  );
};
