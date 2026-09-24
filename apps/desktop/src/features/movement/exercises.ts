import { OVERHEAD_REACH_TARGET_REPS, OverheadReachTracker } from './overhead-reach'
import { SQUAT_TARGET_REPS, SQUAT_TARGET_Y, SquatTracker } from './squat'
import type { IMovementExerciseDefinition, IMovementPoseSnapshot, MovementExerciseId } from './types'

export const MOVEMENT_EXERCISES: readonly IMovementExerciseDefinition[] = [
  {
    id: 'squat',
    title: 'Squat set',
    pickerLabel: '10× Squats',
    pickerDescription: 'Lower body',
    actionLabel: 'Start 10 Squats movement break',
    dialogLabel: '10 Squats movement break',
    targetReps: SQUAT_TARGET_REPS,
    progressLabel: 'Squat depth',
    trackingLabel: 'SHOULDER',
    targetLabel: 'SQUAT TO HERE',
    previewLabel: 'LIVE · shoulder',
    initialGuidance: 'Stand tall to begin',
    trackingLostGuidance: 'Keep both shoulders inside the camera',
    completionGuidance: '10 squats complete',
    initialTargetLineY: SQUAT_TARGET_Y,
    demoTrackingLineY: 0.31,
    demoTargetLineY: SQUAT_TARGET_Y,
    demoProgress: 0.48,
    createTracker: () => new SquatTracker(),
  },
  {
    id: 'overhead-reach',
    title: 'Overhead Reach',
    pickerLabel: '10× Reaches',
    pickerDescription: 'Upper body',
    actionLabel: 'Start 10 Overhead Reaches movement break',
    dialogLabel: '10 Overhead Reaches movement break',
    targetReps: OVERHEAD_REACH_TARGET_REPS,
    progressLabel: 'Reach height',
    trackingLabel: 'HANDS',
    targetLabel: 'REACH ABOVE',
    previewLabel: 'LIVE · shoulders + hands',
    initialGuidance: 'Keep both shoulders and hands visible',
    trackingLostGuidance: 'Keep both shoulders and hands inside the camera',
    completionGuidance: '10 overhead reaches complete',
    initialTargetLineY: null,
    demoTrackingLineY: 0.28,
    demoTargetLineY: 0.36,
    demoProgress: 0.72,
    createTracker: () => new OverheadReachTracker(),
  },
] as const

export const getMovementExercise = (exerciseId: MovementExerciseId): IMovementExerciseDefinition =>
  MOVEMENT_EXERCISES.find((exercise) => exercise.id === exerciseId) ?? MOVEMENT_EXERCISES[0]

export const createInitialMovementSnapshot = (
  exerciseId: MovementExerciseId = 'squat',
  sessionId: string | null = null,
): IMovementPoseSnapshot => {
  const exercise = getMovementExercise(exerciseId)
  return {
    exerciseId: exercise.id,
    status: 'idle',
    repCount: 0,
    targetReps: exercise.targetReps,
    guidance: `Camera starts only after you choose ${exercise.pickerLabel}`,
    permission: 'notDetermined',
    sessionId,
    trackingLineY: null,
    targetLineY: exercise.initialTargetLineY,
    progress: 0,
    error: null,
  }
}
