import {
  clampMovementProgress,
  MIN_MOVEMENT_LANDMARK_VISIBILITY,
  MOVEMENT_POSE_DWELL_MS,
  MOVEMENT_TRACKING_LOSS_RESET_MS,
  visibleMovementLandmark,
} from './model'
import type { IMovementLandmark, IMovementTracker, IMovementTrackerUpdate, MovementTrackerEvent } from './types'

export const SQUAT_TARGET_REPS = 10
export const SQUAT_TARGET_Y = 0.86

const CALIBRATION_SAMPLES = 7
const BOTTOM_PROGRESS = 0.9
const RETURN_PROGRESS = 0.24

export interface IShoulderMeasurement {
  shoulderY: number
  confidence: number
}

type ShoulderSquatPhase = 'calibrating' | 'ready' | 'bottom-candidate' | 'bottom' | 'return-candidate'

export const measureShoulderLine = (landmarks: Array<IMovementLandmark | undefined>): IShoulderMeasurement | null => {
  const shoulders = [visibleMovementLandmark(landmarks, 11), visibleMovementLandmark(landmarks, 12)].filter(
    (point): point is IMovementLandmark => point !== null,
  )
  if (shoulders.length === 0) return null
  return {
    shoulderY: shoulders.reduce((sum, point) => sum + point.y, 0) / shoulders.length,
    confidence: Math.min(...shoulders.map((point) => point.visibility ?? 1)),
  }
}

export class ShoulderSquatCounter {
  private phase: ShoulderSquatPhase = 'calibrating'
  private calibration: number[] = []
  private standingShoulderY: number | null = null
  private phaseSinceMs = 0
  private trackingLostSinceMs: number | null = null
  private reps = 0
  private currentProgress = 0

  get count(): number {
    return this.reps
  }
  get targetLineY(): number {
    return SQUAT_TARGET_Y
  }
  get progress(): number {
    return this.currentProgress
  }

  get guidance(): string {
    if (this.phase === 'calibrating') return 'Stand tall · keep both shoulders visible'
    if (this.phase === 'ready' || this.phase === 'bottom-candidate') return 'Squat down · move white to green'
    return 'Target reached · stand back up'
  }

  update(timestampMs: number, measurement: IShoulderMeasurement | null): MovementTrackerEvent {
    if (!measurement || measurement.confidence < MIN_MOVEMENT_LANDMARK_VISIBILITY) return this.trackingLost(timestampMs)
    this.trackingLostSinceMs = null

    if (this.phase === 'calibrating' || this.standingShoulderY === null) {
      this.calibration.push(measurement.shoulderY)
      if (this.calibration.length > CALIBRATION_SAMPLES) this.calibration.shift()
      if (this.calibration.length === CALIBRATION_SAMPLES) {
        const range = Math.max(...this.calibration) - Math.min(...this.calibration)
        if (range <= 0.035) {
          this.standingShoulderY = this.calibration.reduce((sum, value) => sum + value, 0) / this.calibration.length
          this.phase = 'ready'
        }
      }
      this.currentProgress = 0
      return 'none'
    }

    this.currentProgress = clampMovementProgress(
      (measurement.shoulderY - this.standingShoulderY) / Math.max(0.05, SQUAT_TARGET_Y - this.standingShoulderY),
    )
    if (this.phase === 'ready' && this.currentProgress < 0.12) {
      this.standingShoulderY = this.standingShoulderY * 0.96 + measurement.shoulderY * 0.04
    }

    if (this.phase === 'ready' && this.currentProgress >= BOTTOM_PROGRESS)
      this.setPhase('bottom-candidate', timestampMs)
    else if (
      this.phase === 'bottom-candidate' &&
      this.currentProgress >= BOTTOM_PROGRESS &&
      timestampMs - this.phaseSinceMs >= MOVEMENT_POSE_DWELL_MS
    )
      this.phase = 'bottom'
    else if (this.phase === 'bottom-candidate' && this.currentProgress < BOTTOM_PROGRESS) this.phase = 'ready'
    else if (this.phase === 'bottom' && this.currentProgress <= RETURN_PROGRESS)
      this.setPhase('return-candidate', timestampMs)
    else if (
      this.phase === 'return-candidate' &&
      this.currentProgress <= RETURN_PROGRESS &&
      timestampMs - this.phaseSinceMs >= MOVEMENT_POSE_DWELL_MS
    ) {
      this.reps = Math.min(SQUAT_TARGET_REPS, this.reps + 1)
      this.phase = 'ready'
      return this.reps === SQUAT_TARGET_REPS ? 'completed' : 'rep'
    } else if (this.phase === 'return-candidate' && this.currentProgress > RETURN_PROGRESS) this.phase = 'bottom'
    return 'none'
  }

  private trackingLost(timestampMs: number): MovementTrackerEvent {
    if (this.trackingLostSinceMs === null) this.trackingLostSinceMs = timestampMs
    if (timestampMs - this.trackingLostSinceMs >= MOVEMENT_TRACKING_LOSS_RESET_MS && this.phase !== 'calibrating') {
      this.phase = 'ready'
      this.currentProgress = 0
    }
    return 'tracking-lost'
  }

  private setPhase(phase: ShoulderSquatPhase, timestampMs: number): void {
    this.phase = phase
    this.phaseSinceMs = timestampMs
  }
}

export class SquatTracker implements IMovementTracker {
  private readonly counter = new ShoulderSquatCounter()

  update(timestampMs: number, landmarks: Array<IMovementLandmark | undefined>): IMovementTrackerUpdate {
    const measurement = measureShoulderLine(landmarks)
    return {
      event: this.counter.update(timestampMs, measurement),
      repCount: this.counter.count,
      guidance: this.counter.guidance,
      trackingLineY: measurement?.shoulderY ?? null,
      targetLineY: this.counter.targetLineY,
      progress: this.counter.progress,
    }
  }
}
