export const MOVEMENT_TARGET_REPS = 10 as const;
export const SHOULDER_TARGET_DROP = 0.27;

const CALIBRATION_SAMPLES = 7;
const BOTTOM_PROGRESS = 0.9;
const RETURN_PROGRESS = 0.24;
const POSE_DWELL_MS = 160;
const TRACKING_LOSS_RESET_MS = 700;
const MIN_SHOULDER_VISIBILITY = 0.55;

export interface IShoulderLandmark {
  y: number;
  visibility?: number;
}

export interface IShoulderMeasurement {
  shoulderY: number;
  confidence: number;
}

export type ShoulderSquatEvent =
  | { type: "none" }
  | { type: "rep"; count: number }
  | { type: "completed" }
  | { type: "tracking-lost" };

type ShoulderSquatPhase = "calibrating" | "ready" | "bottom-candidate" | "bottom" | "return-candidate";

export const measureShoulderLine = (landmarks: Array<IShoulderLandmark | undefined>): IShoulderMeasurement | null => {
  const shoulders = [landmarks[11], landmarks[12]].filter((point): point is IShoulderLandmark => point !== undefined && (point.visibility ?? 1) >= MIN_SHOULDER_VISIBILITY);
  if (shoulders.length === 0) return null;
  return {
    shoulderY: shoulders.reduce((sum, point) => sum + point.y, 0) / shoulders.length,
    confidence: Math.min(...shoulders.map((point) => point.visibility ?? 1)),
  };
};

export class ShoulderSquatCounter {
  private phase: ShoulderSquatPhase = "calibrating";
  private calibration: number[] = [];
  private standingShoulderY: number | null = null;
  private phaseSinceMs = 0;
  private trackingLostSinceMs: number | null = null;
  private reps = 0;
  private currentProgress = 0;

  get count(): number { return this.reps; }
  get shoulderBaselineY(): number | null { return this.standingShoulderY; }
  get targetLineY(): number | null { return this.standingShoulderY === null ? null : Math.min(0.88, this.standingShoulderY + SHOULDER_TARGET_DROP); }
  get depthProgress(): number { return this.currentProgress; }

  get guidance(): string {
    if (this.phase === "calibrating") return "Stand tall · keep both shoulders visible";
    if (this.phase === "ready" || this.phase === "bottom-candidate") return "Squat down · move white to green";
    return "Target reached · stand back up";
  }

  update(timestampMs: number, measurement: IShoulderMeasurement | null): ShoulderSquatEvent {
    if (!measurement || measurement.confidence < MIN_SHOULDER_VISIBILITY) return this.trackingLost(timestampMs);
    this.trackingLostSinceMs = null;

    if (this.phase === "calibrating" || this.standingShoulderY === null) {
      this.calibration.push(measurement.shoulderY);
      if (this.calibration.length > CALIBRATION_SAMPLES) this.calibration.shift();
      if (this.calibration.length === CALIBRATION_SAMPLES) {
        const range = Math.max(...this.calibration) - Math.min(...this.calibration);
        if (range <= 0.035) {
          this.standingShoulderY = this.calibration.reduce((sum, value) => sum + value, 0) / this.calibration.length;
          this.phase = "ready";
        }
      }
      this.currentProgress = 0;
      return { type: "none" };
    }

    const target = this.targetLineY ?? this.standingShoulderY + SHOULDER_TARGET_DROP;
    this.currentProgress = Math.max(0, Math.min(1, (measurement.shoulderY - this.standingShoulderY) / Math.max(0.12, target - this.standingShoulderY)));
    if (this.phase === "ready" && this.currentProgress < 0.12) {
      this.standingShoulderY = this.standingShoulderY * 0.96 + measurement.shoulderY * 0.04;
    }

    if (this.phase === "ready" && this.currentProgress >= BOTTOM_PROGRESS) this.setPhase("bottom-candidate", timestampMs);
    else if (this.phase === "bottom-candidate" && this.currentProgress >= BOTTOM_PROGRESS && timestampMs - this.phaseSinceMs >= POSE_DWELL_MS) this.phase = "bottom";
    else if (this.phase === "bottom-candidate" && this.currentProgress < BOTTOM_PROGRESS) this.phase = "ready";
    else if (this.phase === "bottom" && this.currentProgress <= RETURN_PROGRESS) this.setPhase("return-candidate", timestampMs);
    else if (this.phase === "return-candidate" && this.currentProgress <= RETURN_PROGRESS && timestampMs - this.phaseSinceMs >= POSE_DWELL_MS) {
      this.reps = Math.min(MOVEMENT_TARGET_REPS, this.reps + 1);
      this.phase = "ready";
      return this.reps === MOVEMENT_TARGET_REPS ? { type: "completed" } : { type: "rep", count: this.reps };
    } else if (this.phase === "return-candidate" && this.currentProgress > RETURN_PROGRESS) this.phase = "bottom";
    return { type: "none" };
  }

  private trackingLost(timestampMs: number): ShoulderSquatEvent {
    if (this.trackingLostSinceMs === null) this.trackingLostSinceMs = timestampMs;
    if (timestampMs - this.trackingLostSinceMs >= TRACKING_LOSS_RESET_MS && this.phase !== "calibrating") {
      this.phase = "ready";
      this.currentProgress = 0;
    }
    return { type: "tracking-lost" };
  }

  private setPhase(phase: ShoulderSquatPhase, timestampMs: number): void {
    this.phase = phase;
    this.phaseSinceMs = timestampMs;
  }
}
