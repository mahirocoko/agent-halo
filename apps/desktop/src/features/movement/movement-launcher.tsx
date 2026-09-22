import { Bot, Dumbbell, Play } from "lucide-react";
import { useState } from "react";
import { MOVEMENT_EXERCISES } from "./exercises";
import type { MovementExerciseId } from "./types";

export interface IMovementLauncherProps {
  nativeAvailable: boolean;
  onShowCompanion: () => Promise<boolean>;
  onStartMovement: (exerciseId: MovementExerciseId) => Promise<boolean>;
}

export const MovementLauncher = ({ nativeAvailable, onShowCompanion, onStartMovement }: IMovementLauncherProps) => {
  const [launching, setLaunching] = useState<MovementExerciseId | "pet" | null>(null);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);

  const launch = async (target: MovementExerciseId | "pet"): Promise<void> => {
    if (!nativeAvailable || launching !== null) return;
    setLaunching(target);
    setLaunchStatus(null);
    const shown = target === "pet" ? await onShowCompanion() : await onStartMovement(target);
    setLaunchStatus(shown ? "Pet opened" : "Could not open Pet");
    setLaunching(null);
  };

  return (
    <section className="focus-movement-launcher" aria-labelledby="focus-movement-heading">
      <h2 id="focus-movement-heading"><Dumbbell size={13} strokeWidth={2.3} />Move</h2>
      <div className="focus-movement-actions-zone">
        <div className="focus-movement-launcher-actions" aria-label="Start a movement break">
          {MOVEMENT_EXERCISES.map((exercise) => (
            <div className="focus-movement-launcher-row" key={exercise.id}>
              <span className="focus-movement-launcher-exercise">
                <strong>{exercise.id === "squat" ? "Squat" : "Reach"}</strong>
                <small>{exercise.pickerLabel}</small>
              </span>
              <button className="btn accent focus-movement-launch-action" type="button" disabled={!nativeAvailable || launching !== null} onClick={() => void launch(exercise.id)} aria-label={exercise.actionLabel} data-tauri-drag-region="false">
                <Play size={12} fill="currentColor" strokeWidth={2.4} />{launching === exercise.id ? "Opening…" : "Start"}
              </button>
            </div>
          ))}
        </div>

        <button className="btn focus-movement-show-pet" type="button" disabled={!nativeAvailable || launching !== null} onClick={() => void launch("pet")} data-tauri-drag-region="false">
          <Bot size={12} strokeWidth={2.3} />{launching === "pet" ? "Opening…" : "Show Pet"}
        </button>
        {launchStatus ? <p className="focus-movement-launcher-status" role="status" aria-live="polite">{launchStatus}</p> : null}
      </div>
    </section>
  );
};
