import { MovementLauncher } from "../movement/movement-launcher";
import type { MovementExerciseId } from "../movement/types";
import { PomodoroPanel } from "../pomodoro/components";
import type { IUsePomodoroResult } from "../pomodoro/usePomodoro";
import { StopwatchPanel } from "../stopwatch/components";
import type { IUseStopwatchResult } from "../stopwatch/useStopwatch";

export interface IFocusToolsPanelProps {
  pomodoro: IUsePomodoroResult;
  stopwatch: IUseStopwatchResult;
  nativeAvailable: boolean;
  onResetAllPomodoro: () => void;
  onShowCompanion: () => Promise<boolean>;
  onStartMovement: (exerciseId: MovementExerciseId) => Promise<boolean>;
}

export const FocusToolsPanel = ({ nativeAvailable, onResetAllPomodoro, onShowCompanion, onStartMovement, pomodoro, stopwatch }: IFocusToolsPanelProps) => (
  <div className="focus-tools-container">
    <div className="focus-tools-tray" data-testid="focus-tools-tray">
      <section className="focus-tool-card focus-tool-card-pomodoro halo-tab-surface halo-surface-lavender" aria-label="Pomodoro">
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="pomodoro">
          <PomodoroPanel pomodoro={pomodoro} onResetAll={onResetAllPomodoro} />
        </div>
      </section>
      <section className="focus-tool-card focus-tool-card-stopwatch halo-tab-surface halo-surface-mint" aria-label="Stopwatch">
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="stopwatch">
          <StopwatchPanel stopwatch={stopwatch} />
        </div>
      </section>
      <section className="focus-tool-card focus-tool-card-move halo-tab-surface halo-surface-sand" aria-label="Move">
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="move">
          <MovementLauncher nativeAvailable={nativeAvailable} onShowCompanion={onShowCompanion} onStartMovement={onStartMovement} />
        </div>
      </section>
    </div>
  </div>
);
