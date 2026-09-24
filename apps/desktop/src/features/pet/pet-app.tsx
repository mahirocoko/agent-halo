import { invoke } from '@tauri-apps/api/core'
import { ArrowLeft, ArrowUp, Clock3, Dumbbell, Focus, Play, X } from 'lucide-react'
import {
  type CSSProperties,
  lazy,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createInitialMovementSnapshot, getMovementExercise, MOVEMENT_EXERCISES } from '../movement/exercises'
import type { IMovementPoseSnapshot, MovementExerciseId } from '../movement/types'
import { HaloPet } from '../session/halo-pet'
import { DEFAULT_HALO_PET_MOTION_MAPPING } from '../session/pet-motion'
import type { ActivityKind, ISessionSummary } from '../session/types'
import { buildCompanionProjection } from './companion-projection'
import type { CompletionPetSize } from './preferences'
import type { ICompanionProjection, ICompletionPetNativeState, ICompletionPetSummon } from './types'

const POLL_MS = 200
const DRAG_THRESHOLD_PX = 4
const MOVEMENT_COMPLETION_DELAY_MS = 1_600
const DONE_BODY_DURATION_MS = 1_700
const SEARCH_PARAMS = new URLSearchParams(window.location.search)
const DEMO_PET = SEARCH_PARAMS.has('demoPet')
const DEMO_PET_SIZE = ((value: string | null): CompletionPetSize =>
  value === 'small' || value === 'medium' ? value : 'large')(SEARCH_PARAMS.get('demoPetSize'))
const MovementChallenge = lazy(async () => {
  const module = await import('../movement/movement-challenge')
  return { default: module.MovementChallenge }
})

const DEMO_SUMMON = {
  schemaVersion: 2,
  id: 'demo-focus-complete',
  purpose: 'focus-completion',
  pet: 'haloform',
  petSize: DEMO_PET_SIZE,
  movementBreakEnabled: true,
  nextPhase: 'short-break',
} satisfies ICompletionPetSummon

const DEMO_PROJECTION: ICompanionProjection = buildCompanionProjection({
  summon: DEMO_SUMMON,
  sessionStatus: 'done',
  activityKind: 'done',
  motionMapping: DEFAULT_HALO_PET_MOTION_MAPPING,
  replayId: 'demo-focus-complete:done',
})

const INITIAL_MOVEMENT_SNAPSHOT = createInitialMovementSnapshot()

const isNative = (): boolean => typeof window.__TAURI_INTERNALS__ !== 'undefined'

const canChooseMovement = (summon: ICompletionPetSummon | null): boolean =>
  summon?.purpose === 'manual-companion' || (summon?.purpose === 'focus-completion' && summon.movementBreakEnabled)

const getPhaseLabel = (summon: ICompletionPetSummon): 'Short' | 'Long' | null =>
  summon.purpose === 'focus-completion' ? (summon.nextPhase === 'long-break' ? 'Long' : 'Short') : null

export const PetApp = () => {
  const [summon, setSummon] = useState<ICompletionPetSummon | null>(DEMO_PET ? DEMO_SUMMON : null)
  const [projection, setProjection] = useState<ICompanionProjection | null>(DEMO_PET ? DEMO_PROJECTION : null)
  const [expanded, setExpanded] = useState(SEARCH_PARAMS.has('demoPetExpanded'))
  const [exercisePickerOpen, setExercisePickerOpen] = useState(false)
  const [selectedExerciseId, setSelectedExerciseId] = useState<MovementExerciseId | null>(null)
  const [movementActive, setMovementActive] = useState(false)
  const [movementSnapshot, setMovementSnapshot] = useState<IMovementPoseSnapshot>(INITIAL_MOVEMENT_SNAPSHOT)
  const [busy, setBusy] = useState(false)
  const [rebaseOffset, setRebaseOffset] = useState<{ x: number; y: number } | null>(null)
  const [doneIntroSummonId, setDoneIntroSummonId] = useState<string | null>(DEMO_PET ? DEMO_SUMMON.id : null)
  const [manualDoneAcknowledgementId, setManualDoneAcknowledgementId] = useState<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)
  const suppressClickRef = useRef(false)
  const startActionRef = useRef<HTMLButtonElement | null>(null)
  const focusActionRef = useRef<HTMLButtonElement | null>(null)
  const closeActionRef = useRef<HTMLButtonElement | null>(null)
  const companionRef = useRef<HTMLButtonElement | null>(null)
  const movementActionRef = useRef<HTMLButtonElement | null>(null)
  const squatActionRef = useRef<HTMLButtonElement | null>(null)
  const reachActionRef = useRef<HTMLButtonElement | null>(null)
  const previousSummonIdRef = useRef<string | null>(summon?.id ?? null)
  const movementActiveRef = useRef(false)
  const movementCompletionSubmittedRef = useRef(false)
  const movementAttemptRef = useRef(0)
  const movementAutoStartSummonIdRef = useRef<string | null>(null)
  const rebaseTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (DEMO_PET || !isNative()) return undefined
    let disposed = false
    const refresh = async () => {
      try {
        const snapshot = await invoke<ICompletionPetNativeState>('completion_pet_state')
        if (!disposed) {
          setSummon(snapshot.summon)
          setProjection(snapshot.projection ?? null)
        }
      } catch {
        // The native window remains hidden when its projection cannot be read.
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
      if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (summon?.id === previousSummonIdRef.current) return
    previousSummonIdRef.current = summon?.id ?? null
    if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current)
    rebaseTimerRef.current = null
    setRebaseOffset(null)
    setProjection((current) => (current?.summon.id === summon?.id ? current : null))
    setExpanded(false)
    setExercisePickerOpen(false)
    setSelectedExerciseId(null)
    movementActiveRef.current = false
    setMovementActive(false)
    setMovementSnapshot(INITIAL_MOVEMENT_SNAPSHOT)
    movementCompletionSubmittedRef.current = false
    movementAutoStartSummonIdRef.current = null
    setDoneIntroSummonId(summon?.purpose === 'focus-completion' ? summon.id : null)
    setManualDoneAcknowledgementId(null)
    setBusy(false)
  }, [summon?.id])

  useEffect(() => {
    if (!doneIntroSummonId) return undefined
    const introSummonId = doneIntroSummonId
    const timer = window.setTimeout(() => {
      setDoneIntroSummonId((current) => (current === introSummonId ? null : current))
    }, DONE_BODY_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [doneIntroSummonId])

  useEffect(() => {
    if (!manualDoneAcknowledgementId) return undefined
    const timer = window.setTimeout(() => setManualDoneAcknowledgementId(null), DONE_BODY_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [manualDoneAcknowledgementId])

  useEffect(() => {
    movementActiveRef.current = movementActive
  }, [movementActive])

  const setBubbleOpen = async (open: boolean, focusAction = false): Promise<void> => {
    let beforePetPosition: { x: number; y: number } | null = null
    const collapsedCenter = { x: 58, y: 44 }
    if (isNative()) {
      try {
        if (open) {
          beforePetPosition = {
            x: window.screenX + collapsedCenter.x,
            y: window.screenY + collapsedCenter.y,
          }
          await invoke('activate_completion_pet')
        }
        await invoke('set_completion_pet_expanded', { expanded: open })
      } catch {
        setExpanded(false)
        return
      }
    }
    if (open && beforePetPosition) {
      setRebaseOffset({
        x: beforePetPosition.x - (window.screenX + 130),
        y: beforePetPosition.y - (window.screenY + 116),
      })
      if (rebaseTimerRef.current !== null) window.clearTimeout(rebaseTimerRef.current)
      rebaseTimerRef.current = window.setTimeout(() => {
        setRebaseOffset(null)
        rebaseTimerRef.current = null
      }, 420)
    } else if (!open) {
      setRebaseOffset(null)
    }
    setExpanded(open)
    if (!open) setExercisePickerOpen(false)
    if (open && focusAction) {
      window.requestAnimationFrame(() => {
        const target =
          summon?.purpose === 'setup-preview'
            ? closeActionRef.current
            : summon?.purpose === 'manual-companion'
              ? focusActionRef.current
              : startActionRef.current
        target?.focus()
      })
    }
    if (!open && focusAction) window.requestAnimationFrame(() => companionRef.current?.focus())
  }

  const hide = async (): Promise<void> => {
    movementActiveRef.current = false
    setMovementActive(false)
    setExercisePickerOpen(false)
    setSelectedExerciseId(null)
    setMovementSnapshot(INITIAL_MOVEMENT_SNAPSHOT)
    setManualDoneAcknowledgementId(null)
    setDoneIntroSummonId(null)
    movementCompletionSubmittedRef.current = false
    setSummon(null)
    setProjection(null)
    setExpanded(false)
    setBusy(false)
    movementAutoStartSummonIdRef.current = null
    if (DEMO_PET || !isNative()) return
    await invoke('hide_completion_pet').catch(() => undefined)
  }

  const submit = async (action: 'start-break' | 'movement-complete' | 'open-focus'): Promise<void> => {
    if (busy) return
    setBusy(true)
    if (DEMO_PET || !isNative()) {
      window.__AGENT_HALO_PET_ACTIONS__ = [...(window.__AGENT_HALO_PET_ACTIONS__ ?? []), action]
      if (action === 'open-focus') {
        setBusy(false)
        await setBubbleOpen(false, true)
        return
      }
      movementActiveRef.current = false
      setMovementActive(false)
      setExercisePickerOpen(false)
      setSelectedExerciseId(null)
      setSummon(null)
      setProjection(null)
      setExpanded(false)
      return
    }
    try {
      await invoke('submit_completion_pet_action', { action })
      if (action === 'open-focus') {
        setBusy(false)
        await setBubbleOpen(false, true)
        return
      }
      movementActiveRef.current = false
      setMovementActive(false)
      setExercisePickerOpen(false)
      setSelectedExerciseId(null)
      setSummon(null)
      setProjection(null)
      setExpanded(false)
      setBusy(false)
    } catch {
      setBusy(false)
    }
  }

  const openExercisePicker = (): void => {
    if (busy || !canChooseMovement(summon)) return
    setExercisePickerOpen(true)
    window.requestAnimationFrame(() => squatActionRef.current?.focus())
  }

  const closeExercisePicker = (): void => {
    setExercisePickerOpen(false)
    window.requestAnimationFrame(() => movementActionRef.current?.focus())
  }

  const startMovement = async (exerciseId: MovementExerciseId): Promise<void> => {
    if (busy || !summon || !canChooseMovement(summon)) return
    const activeSummon = summon
    const exercise = getMovementExercise(exerciseId)
    setBusy(true)
    setExercisePickerOpen(false)
    setSelectedExerciseId(exercise.id)
    const movementAttempt = movementAttemptRef.current + 1
    movementAttemptRef.current = movementAttempt
    movementCompletionSubmittedRef.current = false
    const initialSnapshot = createInitialMovementSnapshot(exercise.id, `${activeSummon.id}:${movementAttempt}`)
    setMovementSnapshot({ ...initialSnapshot, status: 'requesting', guidance: 'Waiting for Camera permission…' })
    if (DEMO_PET || !isNative()) {
      setMovementActive(true)
      setExpanded(false)
      setMovementSnapshot({ ...initialSnapshot, status: 'tracking', guidance: exercise.initialGuidance })
      setBusy(false)
      return
    }
    try {
      await invoke('set_completion_pet_movement', { active: true, summonId: activeSummon.id })
      movementActiveRef.current = true
      setMovementActive(true)
      setExpanded(false)
      setBusy(false)
      if (SEARCH_PARAMS.has('demoMovementCompleted')) {
        setMovementSnapshot({
          ...initialSnapshot,
          status: 'completed',
          repCount: exercise.targetReps,
          guidance: exercise.completionGuidance,
          progress: 1,
        })
      } else if (SEARCH_PARAMS.has('demoCameraOff')) {
        setMovementSnapshot({
          ...initialSnapshot,
          status: 'tracking',
          permission: 'authorized',
          guidance: exercise.initialGuidance,
        })
      }
      return
    } catch (error) {
      setMovementSnapshot({
        ...initialSnapshot,
        status: 'error',
        guidance: 'Camera could not start',
        error: error instanceof Error ? error.message : 'Could not start the local pose session',
      })
      movementActiveRef.current = false
      setMovementActive(false)
    } finally {
      setBusy(false)
    }
  }

  const cancelMovement = async (): Promise<void> => {
    if (busy || !summon) return
    const activeSummon = summon
    const focusCompletion = activeSummon.purpose === 'focus-completion'
    const exerciseId = selectedExerciseId ?? movementSnapshot.exerciseId
    setBusy(true)
    movementActiveRef.current = false
    setMovementActive(false)
    setExercisePickerOpen(false)
    setSelectedExerciseId(null)
    setMovementSnapshot(createInitialMovementSnapshot(exerciseId))
    movementCompletionSubmittedRef.current = false

    const restoreCompanion = async (): Promise<void> => {
      if (focusCompletion) {
        setExpanded(true)
        setExercisePickerOpen(true)
        window.requestAnimationFrame(() =>
          (exerciseId === 'overhead-reach' ? reachActionRef.current : squatActionRef.current)?.focus(),
        )
        return
      }
      await setBubbleOpen(false, true)
    }

    if (DEMO_PET || !isNative()) {
      await restoreCompanion()
      setBusy(false)
      return
    }

    try {
      await invoke('set_completion_pet_movement', { active: false, summonId: activeSummon.id })
    } catch {
      setSummon(null)
      setProjection(null)
      setExpanded(false)
      await invoke('hide_completion_pet').catch(() => undefined)
      setBusy(false)
      return
    }

    await restoreCompanion()
    setBusy(false)
  }

  const finishManualMovement = async (summonId: string): Promise<void> => {
    if (!summon || summon.id !== summonId || summon.purpose !== 'manual-companion' || !movementActiveRef.current) return
    const activeSummon = summon
    setBusy(true)
    if (!DEMO_PET && isNative()) {
      try {
        await invoke('set_completion_pet_movement', { active: false, summonId: activeSummon.id })
      } catch {
        await hide()
        return
      }
    }
    movementActiveRef.current = false
    setMovementActive(false)
    setExercisePickerOpen(false)
    setSelectedExerciseId(null)
    setMovementSnapshot(INITIAL_MOVEMENT_SNAPSHOT)
    await setBubbleOpen(false, true)
    setBusy(false)
    setManualDoneAcknowledgementId(`${activeSummon.id}:movement-done:${movementAttemptRef.current}`)
  }

  useEffect(() => {
    if (!movementActive || movementSnapshot.status !== 'completed' || movementCompletionSubmittedRef.current || !summon)
      return undefined
    movementCompletionSubmittedRef.current = true
    const activeSummon = summon
    const timer = window.setTimeout(() => {
      if (activeSummon.purpose === 'manual-companion') void finishManualMovement(activeSummon.id)
      else void submit('movement-complete')
    }, MOVEMENT_COMPLETION_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [movementActive, movementSnapshot.status, summon?.id, summon?.purpose])

  const requestedExerciseId = summon?.purpose === 'manual-companion' ? summon.requestedExerciseId : undefined

  useEffect(() => {
    if (!summon || summon.purpose !== 'manual-companion' || !requestedExerciseId || busy || movementActive) return
    if (movementAutoStartSummonIdRef.current === summon.id) return
    movementAutoStartSummonIdRef.current = summon.id
    void startMovement(requestedExerciseId)
  }, [busy, movementActive, requestedExerciseId, summon?.id, summon?.purpose])

  const beginPointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (expanded || event.button !== 0) return
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    draggingRef.current = false
    suppressClickRef.current = false
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const movePointer = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const origin = dragStartRef.current
    if (!origin || expanded || draggingRef.current) return
    if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < DRAG_THRESHOLD_PX) return
    draggingRef.current = true
    suppressClickRef.current = true
    if (isNative()) void invoke('drag_completion_pet').catch(() => undefined)
  }

  const endPointer = (): void => {
    dragStartRef.current = null
    if (draggingRef.current)
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    draggingRef.current = false
  }

  if (!summon) return <main className="completion-pet-root" data-visible="false" />

  const currentProjection = projection?.summon.id === summon.id ? projection : null
  const doneAcknowledgementActive = manualDoneAcknowledgementId?.startsWith(`${summon.id}:`) ?? false
  const doneIntroActive = doneIntroSummonId === summon.id
  const showDoneState = currentProjection !== null && (doneIntroActive || doneAcknowledgementActive)
  const visualSessionStatus: ISessionSummary['status'] = showDoneState
    ? 'done'
    : (currentProjection?.sessionStatus ?? 'idle')
  const visualActivityKind: ActivityKind = showDoneState ? 'done' : (currentProjection?.activityKind ?? 'session')
  const visualMotionMapping = currentProjection?.motionMapping ?? DEFAULT_HALO_PET_MOTION_MAPPING
  const visualReplayId = currentProjection?.replayId ?? `${summon.id}:idle`
  const visualReplayKey = `${visualReplayId}:${visualSessionStatus}:${visualActivityKind}:${manualDoneAcknowledgementId ?? doneIntroSummonId ?? 'steady'}`
  const movementAvailable = canChooseMovement(summon)
  const phaseLabel = getPhaseLabel(summon)
  const contextCopy =
    summon.purpose === 'focus-completion'
      ? `Focus complete · ${phaseLabel} break ready`
      : summon.purpose === 'manual-companion'
        ? 'Manual companion'
        : 'Setup preview'
  const companionAriaLabel =
    summon.purpose === 'focus-completion'
      ? 'Focus complete. Open break actions'
      : summon.purpose === 'manual-companion'
        ? 'Manual companion. Open controls'
        : 'Pet setup preview. Open controls'
  const movementPickerLabel =
    summon.purpose === 'focus-completion' ? 'Choose movement break exercise' : 'Choose movement exercise'
  const movementBackLabel =
    summon.purpose === 'focus-completion' ? 'Back to break actions' : 'Back to companion actions'
  const statusCopy =
    summon.purpose === 'focus-completion'
      ? `Focus complete. ${phaseLabel} break ready.`
      : summon.purpose === 'manual-companion'
        ? 'Manual companion.'
        : 'Pet setup preview.'

  if (movementActive) {
    return (
      <main className="completion-pet-root" data-visible="true" data-movement="true" data-purpose={summon.purpose}>
        <Suspense
          fallback={
            <div className="movement-loading" role="status">
              Preparing local pose…
            </div>
          }
        >
          <MovementChallenge
            allowStartBreak={summon.purpose === 'focus-completion'}
            snapshot={movementSnapshot}
            busy={busy}
            cameraPreviewEnabled={isNative() && !SEARCH_PARAMS.has('demoCameraOff')}
            demoPoseEnabled={SEARCH_PARAMS.has('demoPose')}
            onCancel={() => void cancelMovement()}
            onRetry={() => void startMovement(selectedExerciseId ?? movementSnapshot.exerciseId)}
            onSnapshot={setMovementSnapshot}
            onStartBreak={() => {
              // Keep the callback purpose-gated as an extra safety boundary for manual failures.
              if (summon.purpose === 'focus-completion') void submit('start-break')
            }}
          />
        </Suspense>
      </main>
    )
  }

  return (
    <main
      className="completion-pet-root"
      data-visible="true"
      data-expanded={expanded ? 'true' : 'false'}
      data-exercise-picker={exercisePickerOpen ? 'true' : 'false'}
      data-rebasing={rebaseOffset ? 'true' : 'false'}
      data-pet-size={summon.petSize}
      data-purpose={summon.purpose}
      data-preview={summon.purpose === 'setup-preview' ? 'true' : undefined}
      data-movement-option={movementAvailable ? 'true' : 'false'}
      data-projection-replay-id={visualReplayId}
      style={
        rebaseOffset
          ? ({ '--pet-rebase-x': `${rebaseOffset.x}px`, '--pet-rebase-y': `${rebaseOffset.y}px` } as CSSProperties)
          : undefined
      }
      onKeyDown={(event) => {
        if (!expanded || event.key !== 'Escape') return
        event.preventDefault()
        if (exercisePickerOpen) {
          closeExercisePicker()
          return
        }
        void setBubbleOpen(false, true)
      }}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {statusCopy}
      </span>
      {expanded ? (
        exercisePickerOpen ? (
          <section
            className="completion-pet-radial completion-pet-exercise-picker"
            role="dialog"
            aria-label={movementPickerLabel}
            id="completion-pet-actions"
          >
            <span className="completion-pet-orbit" aria-hidden="true" />
            {MOVEMENT_EXERCISES.map((exercise) => (
              <button
                ref={exercise.id === 'squat' ? squatActionRef : reachActionRef}
                className="completion-pet-option completion-pet-exercise-option"
                data-exercise={exercise.id}
                type="button"
                disabled={busy}
                onClick={() => void startMovement(exercise.id)}
                aria-label={exercise.actionLabel}
                key={exercise.id}
              >
                {exercise.id === 'squat' ? (
                  <Dumbbell size={19} strokeWidth={2.3} />
                ) : (
                  <ArrowUp size={20} strokeWidth={2.3} />
                )}
                <span>
                  {exercise.pickerLabel}
                  <br />
                  <small>{exercise.pickerDescription}</small>
                </span>
              </button>
            ))}
            <button
              className="completion-pet-option completion-pet-exercise-back"
              type="button"
              disabled={busy}
              onClick={closeExercisePicker}
              aria-label={movementBackLabel}
            >
              <ArrowLeft size={18} strokeWidth={2.3} />
              <span>Back</span>
            </button>
            <span className="completion-pet-context">Pick one · camera starts next</span>
          </section>
        ) : (
          <section
            className="completion-pet-radial"
            role="dialog"
            aria-label={
              summon.purpose === 'focus-completion'
                ? 'Focus complete actions'
                : summon.purpose === 'manual-companion'
                  ? 'Manual companion controls'
                  : 'Pet setup preview controls'
            }
            id="completion-pet-actions"
          >
            <span className="completion-pet-orbit" aria-hidden="true" />
            {summon.purpose === 'focus-completion' ? (
              <>
                <button
                  ref={startActionRef}
                  className="completion-pet-option completion-pet-start"
                  type="button"
                  disabled={busy}
                  onClick={() => void submit('start-break')}
                  aria-label={`Start ${phaseLabel} break`}
                >
                  <Play size={21} strokeWidth={2.4} />
                  <span>
                    {busy ? (
                      '…'
                    ) : (
                      <>
                        {phaseLabel}
                        <br />
                        break
                      </>
                    )}
                  </span>
                </button>
                {summon.movementBreakEnabled ? (
                  <button
                    ref={movementActionRef}
                    className="completion-pet-option completion-pet-movement"
                    type="button"
                    disabled={busy}
                    onClick={openExercisePicker}
                    aria-label="Choose Movement Break exercise"
                  >
                    <Dumbbell size={20} strokeWidth={2.3} />
                    <span>
                      Choose
                      <br />
                      move
                    </span>
                  </button>
                ) : null}
                <button
                  className="completion-pet-option completion-pet-later"
                  type="button"
                  disabled={busy}
                  onClick={() => void hide()}
                  aria-label="Later"
                >
                  <Clock3 size={20} strokeWidth={2.2} />
                  <span>Later</span>
                </button>
                <button
                  ref={closeActionRef}
                  className="completion-pet-option completion-pet-close"
                  type="button"
                  disabled={busy}
                  onClick={() => void hide()}
                  aria-label="Close"
                >
                  <X size={20} strokeWidth={2.25} />
                  <span>Close</span>
                </button>
              </>
            ) : summon.purpose === 'manual-companion' ? (
              <>
                <button
                  ref={focusActionRef}
                  className="completion-pet-option completion-pet-start"
                  type="button"
                  disabled={busy}
                  onClick={() => void submit('open-focus')}
                  aria-label="Open Focus"
                >
                  <Focus size={20} strokeWidth={2.3} />
                  <span>{busy ? '…' : 'Focus'}</span>
                </button>
                <button
                  ref={movementActionRef}
                  className="completion-pet-option completion-pet-movement"
                  type="button"
                  disabled={busy}
                  onClick={openExercisePicker}
                  aria-label="Choose movement exercise"
                >
                  <Dumbbell size={20} strokeWidth={2.3} />
                  <span>
                    Choose
                    <br />
                    move
                  </span>
                </button>
                <button
                  ref={closeActionRef}
                  className="completion-pet-option completion-pet-close"
                  type="button"
                  disabled={busy}
                  onClick={() => void hide()}
                  aria-label="Hide"
                >
                  <X size={20} strokeWidth={2.25} />
                  <span>Hide</span>
                </button>
              </>
            ) : (
              <button
                ref={closeActionRef}
                className="completion-pet-option completion-pet-close"
                type="button"
                disabled={busy}
                onClick={() => void hide()}
                aria-label="Close"
              >
                <X size={20} strokeWidth={2.25} />
                <span>Close</span>
              </button>
            )}
            <span className="completion-pet-context">{contextCopy}</span>
          </section>
        )
      ) : null}

      <div className="completion-pet-dock">
        <button
          ref={companionRef}
          className="completion-pet-companion"
          type="button"
          aria-label={companionAriaLabel}
          aria-expanded={expanded}
          aria-controls="completion-pet-actions"
          onClick={() => {
            if (suppressClickRef.current) return
            void setBubbleOpen(!expanded, true)
          }}
          onKeyDown={(event) => {
            if (!expanded && ['Enter', ' '].includes(event.key)) {
              event.preventDefault()
              void setBubbleOpen(true, true)
            }
          }}
          onPointerDown={beginPointer}
          onPointerMove={movePointer}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          data-tauri-drag-region="false"
        >
          <HaloPet
            key={visualReplayKey}
            className="completion-pet-visual"
            loadout={summon.loadout}
            motionMapping={visualMotionMapping}
            pet={summon.pet}
            status={visualSessionStatus}
            activityKind={visualActivityKind}
            surface="completion"
          />
        </button>
      </div>
    </main>
  )
}

declare global {
  interface Window {
    __AGENT_HALO_PET_ACTIONS__?: Array<'start-break' | 'movement-complete' | 'open-focus'>
  }
}
