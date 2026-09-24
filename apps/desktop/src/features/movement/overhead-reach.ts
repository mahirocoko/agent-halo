import {
  clampMovementProgress,
  MIN_MOVEMENT_LANDMARK_VISIBILITY,
  MOVEMENT_POSE_DWELL_MS,
  MOVEMENT_TRACKING_LOSS_RESET_MS,
  visibleMovementLandmark,
} from './model'
import type { IMovementLandmark, IMovementTracker, IMovementTrackerUpdate, MovementTrackerEvent } from './types'

export const OVERHEAD_REACH_TARGET_REPS = 10

const DOWN_DISTANCE = -0.05
const OVERHEAD_DISTANCE = 0.08

export interface IOverheadReachMeasurement {
  shoulderY: number
  wristY: number
  leftRaiseDistance: number
  rightRaiseDistance: number
  confidence: number
}

type OverheadReachPhase = 'waiting-start' | 'ready' | 'top-candidate' | 'top' | 'return-candidate'

export const measureOverheadReach = (
  landmarks: Array<IMovementLandmark | undefined>,
): IOverheadReachMeasurement | null => {
  const leftShoulder = visibleMovementLandmark(landmarks, 11)
  const rightShoulder = visibleMovementLandmark(landmarks, 12)
  const leftWrist = visibleMovementLandmark(landmarks, 15)
  const rightWrist = visibleMovementLandmark(landmarks, 16)
  if (!leftShoulder || !rightShoulder || !leftWrist || !rightWrist) return null
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2
  return {
    shoulderY,
    wristY: (leftWrist.y + rightWrist.y) / 2,
    leftRaiseDistance: leftShoulder.y - leftWrist.y,
    rightRaiseDistance: rightShoulder.y - rightWrist.y,
    confidence: Math.min(
      leftShoulder.visibility ?? 1,
      rightShoulder.visibility ?? 1,
      leftWrist.visibility ?? 1,
      rightWrist.visibility ?? 1,
    ),
  }
}

export class OverheadReachCounter {
  private phase: OverheadReachPhase = 'waiting-start'
  private phaseSinceMs = 0
  private trackingLostSinceMs: number | null = null
  private reps = 0
  private currentProgress = 0

  get count(): number {
    return this.reps
  }
  get progress(): number {
    return this.currentProgress
  }

  get guidance(): string {
    if (this.phase === 'waiting-start') return 'Lower both hands below your shoulders to begin'
    if (this.phase === 'ready' || this.phase === 'top-candidate') return 'Reach both hands above the green line'
    return 'Reach complete · lower both hands'
  }

  update(timestampMs: number, measurement: IOverheadReachMeasurement | null): MovementTrackerEvent {
    if (!measurement || measurement.confidence < MIN_MOVEMENT_LANDMARK_VISIBILITY) return this.trackingLost(timestampMs)
    this.trackingLostSinceMs = null
    const minimumRaise = Math.min(measurement.leftRaiseDistance, measurement.rightRaiseDistance)
    this.currentProgress = clampMovementProgress((minimumRaise - DOWN_DISTANCE) / (OVERHEAD_DISTANCE - DOWN_DISTANCE))
    const bothDown = measurement.leftRaiseDistance <= DOWN_DISTANCE && measurement.rightRaiseDistance <= DOWN_DISTANCE
    const bothOverhead =
      measurement.leftRaiseDistance >= OVERHEAD_DISTANCE && measurement.rightRaiseDistance >= OVERHEAD_DISTANCE

    if (this.phase === 'waiting-start') {
      if (bothDown) this.phase = 'ready'
      return 'none'
    }
    if (this.phase === 'ready' && bothOverhead) this.setPhase('top-candidate', timestampMs)
    else if (
      this.phase === 'top-candidate' &&
      bothOverhead &&
      timestampMs - this.phaseSinceMs >= MOVEMENT_POSE_DWELL_MS
    )
      this.phase = 'top'
    else if (this.phase === 'top-candidate' && !bothOverhead) this.phase = 'ready'
    else if (this.phase === 'top' && bothDown) this.setPhase('return-candidate', timestampMs)
    else if (
      this.phase === 'return-candidate' &&
      bothDown &&
      timestampMs - this.phaseSinceMs >= MOVEMENT_POSE_DWELL_MS
    ) {
      this.reps = Math.min(OVERHEAD_REACH_TARGET_REPS, this.reps + 1)
      this.phase = 'ready'
      return this.reps === OVERHEAD_REACH_TARGET_REPS ? 'completed' : 'rep'
    } else if (this.phase === 'return-candidate' && !bothDown) this.phase = 'top'
    return 'none'
  }

  private trackingLost(timestampMs: number): MovementTrackerEvent {
    if (this.trackingLostSinceMs === null) this.trackingLostSinceMs = timestampMs
    if (timestampMs - this.trackingLostSinceMs >= MOVEMENT_TRACKING_LOSS_RESET_MS) {
      this.phase = 'waiting-start'
      this.currentProgress = 0
    }
    return 'tracking-lost'
  }

  private setPhase(phase: OverheadReachPhase, timestampMs: number): void {
    this.phase = phase
    this.phaseSinceMs = timestampMs
  }
}

export class OverheadReachTracker implements IMovementTracker {
  private readonly counter = new OverheadReachCounter()

  update(timestampMs: number, landmarks: Array<IMovementLandmark | undefined>): IMovementTrackerUpdate {
    const measurement = measureOverheadReach(landmarks)
    return {
      event: this.counter.update(timestampMs, measurement),
      repCount: this.counter.count,
      guidance: this.counter.guidance,
      trackingLineY: measurement?.wristY ?? null,
      targetLineY: measurement ? measurement.shoulderY - OVERHEAD_DISTANCE : null,
      progress: this.counter.progress,
    }
  }
}
