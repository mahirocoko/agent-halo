import type { IMovementLandmark } from './types'

export const MIN_MOVEMENT_LANDMARK_VISIBILITY = 0.55
export const MOVEMENT_POSE_DWELL_MS = 160
export const MOVEMENT_TRACKING_LOSS_RESET_MS = 700

export const clampMovementProgress = (value: number): number => Math.max(0, Math.min(1, value))

export const visibleMovementLandmark = (
  landmarks: Array<IMovementLandmark | undefined>,
  index: number,
): IMovementLandmark | null => {
  const landmark = landmarks[index]
  return landmark && (landmark.visibility ?? 1) >= MIN_MOVEMENT_LANDMARK_VISIBILITY ? landmark : null
}
