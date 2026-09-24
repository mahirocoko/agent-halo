import { getHaloBotLoadout, isHaloBotLoadout } from '../session/halo-bot'
import { getHaloPetSemanticState, isHaloPetName } from '../session/halo-pet'
import type { HaloPetMotionMapping } from '../session/pet-motion'
import { normalizeHaloPetMotionMapping } from '../session/pet-motion'
import type { ActivityKind, ISessionSummary } from '../session/types'
import type {
  CompletionPetBreakPhase,
  CompletionPetPurpose,
  ICompanionProjection,
  ICompletionPetSummon,
  IFocusCompletionPetSummon,
  IManualCompanionPetSummon,
  ISetupPreviewPetSummon,
} from './types'

const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'session',
  'thinking',
  'planning',
  'tool',
  'shell',
  'editing',
  'delegating',
  'visual',
  'memory',
  'asking',
  'skill',
  'goal',
  'compact',
  'model',
  'attention',
  'done',
  'error',
  'bridge',
]
const SESSION_STATUSES: readonly ISessionSummary['status'][] = [
  'idle',
  'working',
  'attention',
  'inactive',
  'done',
  'error',
]

export interface ICompanionProjectionInput {
  summon: ICompletionPetSummon
  sessionStatus: ISessionSummary['status']
  activityKind: ActivityKind
  motionMapping: HaloPetMotionMapping
  replayId: string
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isBreakPhase = (value: unknown): value is CompletionPetBreakPhase =>
  value === 'short-break' || value === 'long-break'
const isPurpose = (value: unknown): value is CompletionPetPurpose =>
  value === 'focus-completion' || value === 'manual-companion' || value === 'setup-preview'
const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === 'string' && (ACTIVITY_KINDS as readonly string[]).includes(value)
const isSessionStatus = (value: unknown): value is ISessionSummary['status'] =>
  typeof value === 'string' && (SESSION_STATUSES as readonly string[]).includes(value)
const isPetSize = (value: unknown): value is 'small' | 'medium' | 'large' =>
  value === 'small' || value === 'medium' || value === 'large'

export const normalizeCompletionPetSummon = (value: unknown): ICompletionPetSummon | null => {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !isPurpose(value.purpose) ||
    !isNonEmptyString(value.id) ||
    !isPetSize(value.petSize)
  )
    return null
  if (!isHaloPetName(value.pet)) return null
  const loadout =
    value.loadout === undefined ? undefined : isHaloBotLoadout(value.loadout) ? getHaloBotLoadout(value.loadout) : null
  if (loadout === null) return null
  const base = {
    schemaVersion: 2 as const,
    id: value.id,
    purpose: value.purpose,
    pet: value.pet,
    ...(loadout === undefined ? {} : { loadout }),
    petSize: value.petSize,
  }
  if (value.purpose === 'focus-completion') {
    if (!isBreakPhase(value.nextPhase) || typeof value.movementBreakEnabled !== 'boolean') return null
    return {
      ...base,
      purpose: 'focus-completion',
      nextPhase: value.nextPhase,
      movementBreakEnabled: value.movementBreakEnabled,
    } satisfies IFocusCompletionPetSummon
  }
  if (value.nextPhase !== null) return null
  return value.purpose === 'manual-companion'
    ? value.requestedExerciseId === undefined ||
      value.requestedExerciseId === 'squat' ||
      value.requestedExerciseId === 'overhead-reach'
      ? ({
          ...base,
          purpose: 'manual-companion',
          nextPhase: null,
          ...(value.requestedExerciseId === undefined ? {} : { requestedExerciseId: value.requestedExerciseId }),
        } satisfies IManualCompanionPetSummon)
      : null
    : ({ ...base, purpose: 'setup-preview', nextPhase: null } satisfies ISetupPreviewPetSummon)
}

export const isCompletionPetSummon = (value: unknown): value is ICompletionPetSummon =>
  normalizeCompletionPetSummon(value) !== null

export const buildCompanionProjection = ({
  summon,
  sessionStatus,
  activityKind,
  motionMapping,
  replayId,
}: ICompanionProjectionInput): ICompanionProjection => ({
  schemaVersion: 2,
  summon,
  sessionStatus,
  activityKind,
  dataState: getHaloPetSemanticState(sessionStatus, activityKind),
  motionMapping: normalizeHaloPetMotionMapping(motionMapping),
  replayId,
})

export const normalizeCompanionProjection = (value: unknown): ICompanionProjection | null => {
  if (!isRecord(value)) return null
  const summon = normalizeCompletionPetSummon(value.summon)
  if (
    !summon ||
    !isSessionStatus(value.sessionStatus) ||
    !isActivityKind(value.activityKind) ||
    !isNonEmptyString(value.replayId)
  )
    return null
  return buildCompanionProjection({
    summon,
    sessionStatus: value.sessionStatus,
    activityKind: value.activityKind,
    motionMapping: normalizeHaloPetMotionMapping(value.motionMapping),
    replayId: value.replayId,
  })
}

const areSummonsEqual = (left: ICompletionPetSummon, right: ICompletionPetSummon): boolean =>
  left.id === right.id &&
  left.purpose === right.purpose &&
  left.pet === right.pet &&
  left.loadout === right.loadout &&
  left.petSize === right.petSize &&
  left.nextPhase === right.nextPhase &&
  (left.purpose !== 'manual-companion' ||
    right.purpose !== 'manual-companion' ||
    left.requestedExerciseId === right.requestedExerciseId) &&
  (left.purpose !== 'focus-completion' ||
    right.purpose !== 'focus-completion' ||
    left.movementBreakEnabled === right.movementBreakEnabled)

export const areCompanionProjectionsEqual = (left: ICompanionProjection, right: ICompanionProjection): boolean =>
  left.schemaVersion === right.schemaVersion &&
  areSummonsEqual(left.summon, right.summon) &&
  left.sessionStatus === right.sessionStatus &&
  left.activityKind === right.activityKind &&
  left.dataState === right.dataState &&
  left.replayId === right.replayId &&
  left.motionMapping.idle === right.motionMapping.idle &&
  left.motionMapping.working === right.motionMapping.working &&
  left.motionMapping.attention === right.motionMapping.attention &&
  left.motionMapping.done === right.motionMapping.done &&
  left.motionMapping.error === right.motionMapping.error
