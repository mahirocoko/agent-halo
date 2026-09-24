export type MovementPoseStatus = 'idle' | 'requesting' | 'tracking' | 'completed' | 'denied' | 'unavailable' | 'error'

export type MovementExerciseId = 'squat' | 'overhead-reach'

export interface IMovementLandmark {
  x?: number
  y: number
  visibility?: number
}

export type MovementTrackerEvent = 'none' | 'rep' | 'completed' | 'tracking-lost'

export interface IMovementTrackerUpdate {
  event: MovementTrackerEvent
  repCount: number
  guidance: string
  trackingLineY: number | null
  targetLineY: number | null
  progress: number
}

export interface IMovementTracker {
  update: (timestampMs: number, landmarks: Array<IMovementLandmark | undefined>) => IMovementTrackerUpdate
}

export interface IMovementExerciseDefinition {
  id: MovementExerciseId
  title: string
  pickerLabel: string
  pickerDescription: string
  actionLabel: string
  dialogLabel: string
  targetReps: number
  progressLabel: string
  trackingLabel: string
  targetLabel: string
  previewLabel: string
  initialGuidance: string
  trackingLostGuidance: string
  completionGuidance: string
  initialTargetLineY: number | null
  demoTrackingLineY: number
  demoTargetLineY: number
  demoProgress: number
  createTracker: () => IMovementTracker
}

export interface IMovementPoseSnapshot {
  exerciseId: MovementExerciseId
  status: MovementPoseStatus
  repCount: number
  targetReps: number
  guidance: string
  permission: 'notDetermined' | 'authorized' | 'denied' | 'restricted' | 'unavailable'
  sessionId: string | null
  trackingLineY: number | null
  targetLineY: number | null
  progress: number
  error: string | null
}
