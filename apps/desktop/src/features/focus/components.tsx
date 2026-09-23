import { ResizableCardDivider, useResizableCardLayout, type IResizableCardSpec } from "../../components/resizable-card-tray";
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

const FOCUS_CARD_SPECS: IResizableCardSpec[] = [
  { id: "pomodoro", defaultRatio: 0.4 },
  { id: "stopwatch", defaultRatio: 0.32 },
  { id: "move", defaultRatio: 0.28 },
];

export const FocusToolsPanel = ({ nativeAvailable, onResetAllPomodoro, onShowCompanion, onStartMovement, pomodoro, stopwatch }: IFocusToolsPanelProps) => {
  const layout = useResizableCardLayout({ storageKey: "agent-halo.focus-layout.v1", specs: FOCUS_CARD_SPECS });

  return (
    <div className="focus-tools-container">
      <div className="focus-tools-tray" data-testid="focus-tools-tray" ref={layout.trayRef}>
      <section className="focus-tool-card focus-tool-card-pomodoro halo-tab-surface halo-surface-lavender" aria-label="Pomodoro" style={layout.cardStyle(0)}>
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="pomodoro">
          <PomodoroPanel pomodoro={pomodoro} onResetAll={onResetAllPomodoro} />
        </div>
      </section>
      <ResizableCardDivider layout={layout} index={0} label="Resize Pomodoro and Stopwatch" />
      <section className="focus-tool-card focus-tool-card-stopwatch halo-tab-surface halo-surface-mint" aria-label="Stopwatch" style={layout.cardStyle(1)}>
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="stopwatch">
          <StopwatchPanel stopwatch={stopwatch} />
        </div>
      </section>
      <ResizableCardDivider layout={layout} index={1} label="Resize Stopwatch and Move" />
      <section className="focus-tool-card focus-tool-card-move halo-tab-surface halo-surface-sand" aria-label="Move" style={layout.cardStyle(2)}>
        <div className="halo-inner-scroll" data-scroll-owner="inner" data-focus-card="move">
          <MovementLauncher nativeAvailable={nativeAvailable} onShowCompanion={onShowCompanion} onStartMovement={onStartMovement} />
        </div>
      </section>
      </div>
    </div>
  );
};
