import type { MovementExerciseId } from '../movement/types'
import type { HaloBotLoadout } from '../session/halo-bot'
import type { HaloPetName } from '../session/halo-pet'
import type { HaloPetMotionMapping, HaloPetSemanticState } from '../session/pet-motion'
import type { ActivityKind, ISessionSummary } from '../session/types'
import type { CompletionPetSize } from './preferences'

export type CompletionPetBreakPhase = 'short-break' | 'long-break'
export type CompletionPetPurpose = 'focus-completion' | 'manual-companion' | 'setup-preview'
export type CompletionPetAction = 'start-break' | 'movement-complete' | 'open-focus' | 'dismiss'

interface ICompletionPetSummonBase {
  schemaVersion: 2
  id: string
  purpose: CompletionPetPurpose
  pet: HaloPetName
  loadout?: HaloBotLoadout
  petSize: CompletionPetSize
}

export interface IFocusCompletionPetSummon extends ICompletionPetSummonBase {
  purpose: 'focus-completion'
  movementBreakEnabled: boolean
  nextPhase: CompletionPetBreakPhase
}

export interface IManualCompanionPetSummon extends ICompletionPetSummonBase {
  purpose: 'manual-companion'
  nextPhase: null
  requestedExerciseId?: MovementExerciseId
}

export interface ISetupPreviewPetSummon extends ICompletionPetSummonBase {
  purpose: 'setup-preview'
  nextPhase: null
}

export type ICompletionPetSummon = IFocusCompletionPetSummon | IManualCompanionPetSummon | ISetupPreviewPetSummon

export interface ICompletionPetNativeState {
  summon: ICompletionPetSummon | null
  projection: ICompanionProjection | null
}

export interface ICompletionPetActionRequest {
  action: CompletionPetAction
  summonId: string
  nextPhase: CompletionPetBreakPhase | null
}

export interface ICompanionProjection {
  schemaVersion: 2
  summon: ICompletionPetSummon
  sessionStatus: ISessionSummary['status']
  activityKind: ActivityKind
  dataState: HaloPetSemanticState
  motionMapping: HaloPetMotionMapping
  replayId: string
}

export type CompanionProjection = ICompanionProjection
