import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type ClosedLidTestPhase, isClosedLidTestPhase, isClosedLidTestTransientPhase } from './types'

const POLL_INTERVAL_MS = 2_000

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  if (typeof error === 'string' && error.trim().length > 0) return error
  return fallback
}

export interface IUseClosedLidTestResult {
  phase: ClosedLidTestPhase | null
  pending: boolean
  error: string | null
  setEnabled: (enabled: boolean) => Promise<string | null> | undefined
}

/**
 * Tracks native closed-lid keep-awake status via serialized, non-overlapping Tauri invocations.
 * Never enables on mount or assumes an optimistic On state.
 */
export const useClosedLidTest = (canUseNativeControls: boolean): IUseClosedLidTestResult => {
  const [phase, setPhase] = useState<ClosedLidTestPhase | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestRef = useRef<Promise<unknown>>(Promise.resolve())
  const phaseRef = useRef<ClosedLidTestPhase | null>(null)
  const actionPendingRef = useRef(false)
  const pollTimerRef = useRef<number | null>(null)
  const mountGenRef = useRef(0)

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  const applyPhase = useCallback((nextPhase: ClosedLidTestPhase | null) => {
    phaseRef.current = nextPhase
    setPhase(nextPhase)
  }, [])

  const isCurrentMount = useCallback(
    (mountGen: number, isDisposed: () => boolean) => !isDisposed() && mountGen === mountGenRef.current,
    [],
  )

  const schedulePoll = useCallback(
    (mountGen: number, isDisposed: () => boolean, runRefresh: () => void) => {
      clearPollTimer()
      if (!isCurrentMount(mountGen, isDisposed)) return
      pollTimerRef.current = window.setTimeout(() => {
        pollTimerRef.current = null
        if (!isCurrentMount(mountGen, isDisposed)) return
        runRefresh()
      }, POLL_INTERVAL_MS)
    },
    [clearPollTimer, isCurrentMount],
  )

  const enqueueStatusRefresh = useCallback(
    (mountGen: number, isDisposed: () => boolean, showPending: boolean) => {
      if (showPending) {
        setPending(true)
      }
      const request = requestRef.current
        .catch(() => undefined)
        .then(() => {
          if (!isCurrentMount(mountGen, isDisposed)) return undefined
          return invoke<unknown>('get_closed_lid_test_status')
        })
        .then((result) => {
          if (!isCurrentMount(mountGen, isDisposed)) return
          if (isClosedLidTestPhase(result)) {
            applyPhase(result)
            setError(null)
            if (isClosedLidTestTransientPhase(result)) {
              schedulePoll(mountGen, isDisposed, () => enqueueStatusRefresh(mountGen, isDisposed, false))
            }
          } else {
            // Minimal test mocks may return null for unrelated commands; treat safely as unavailable.
            applyPhase('unavailable')
            setError(null)
          }
        })
        .catch((err: unknown) => {
          if (!isCurrentMount(mountGen, isDisposed)) return
          setError(toErrorMessage(err, 'Failed to read closed-lid test status'))
          if (isClosedLidTestTransientPhase(phaseRef.current)) {
            schedulePoll(mountGen, isDisposed, () => enqueueStatusRefresh(mountGen, isDisposed, false))
          }
        })
        .finally(() => {
          if (!isCurrentMount(mountGen, isDisposed)) return
          if (showPending) {
            setPending(false)
          }
        })
      requestRef.current = request
    },
    [applyPhase, isCurrentMount, schedulePoll],
  )

  const activeDisposeRef = useRef<() => boolean>(() => true)

  useEffect(() => {
    clearPollTimer()
    actionPendingRef.current = false
    const mountGen = ++mountGenRef.current

    if (!canUseNativeControls) {
      activeDisposeRef.current = () => true
      applyPhase(null)
      setPending(false)
      setError(null)
      return undefined
    }

    let disposed = false
    const isDisposed = () => disposed
    activeDisposeRef.current = isDisposed

    setError(null)
    enqueueStatusRefresh(mountGen, isDisposed, true)

    return () => {
      disposed = true
      clearPollTimer()
      actionPendingRef.current = false
    }
  }, [applyPhase, canUseNativeControls, clearPollTimer, enqueueStatusRefresh])

  const setEnabled = useCallback(
    (enabled: boolean) => {
      if (!canUseNativeControls || actionPendingRef.current) return
      if (enabled ? phaseRef.current !== 'ready' : phaseRef.current !== 'active') return
      const mountGen = mountGenRef.current
      const isDisposed = activeDisposeRef.current
      if (!isCurrentMount(mountGen, isDisposed)) return

      clearPollTimer()
      actionPendingRef.current = true
      setPending(true)
      setError(null)

      const command = enabled ? 'start_closed_lid_test' : 'stop_closed_lid_test'
      const fallbackError = enabled
        ? 'Failed to turn on closed-lid keep awake'
        : 'Failed to turn off closed-lid keep awake'

      const request = requestRef.current
        .catch(() => undefined)
        // An accepted click must reach native even if collapsing unmounts the row.
        .then(() => invoke<unknown>(command))
        .then((result) => {
          if (!isCurrentMount(mountGen, isDisposed)) return null
          if (isClosedLidTestPhase(result)) {
            applyPhase(result)
            setError(null)
            if (isClosedLidTestTransientPhase(result)) {
              schedulePoll(mountGen, isDisposed, () => enqueueStatusRefresh(mountGen, isDisposed, false))
            }
          } else {
            applyPhase('unavailable')
          }
          return null
        })
        .catch((err: unknown) => {
          const message = toErrorMessage(err, fallbackError)
          if (isCurrentMount(mountGen, isDisposed)) {
            setError(message)
            if (isClosedLidTestTransientPhase(phaseRef.current)) {
              schedulePoll(mountGen, isDisposed, () => enqueueStatusRefresh(mountGen, isDisposed, false))
            }
          }
          return message
        })
        .finally(() => {
          if (!isCurrentMount(mountGen, isDisposed)) return
          actionPendingRef.current = false
          setPending(false)
        })
      requestRef.current = request
      return request
    },
    [applyPhase, canUseNativeControls, clearPollTimer, enqueueStatusRefresh, isCurrentMount, schedulePoll],
  )

  return {
    phase,
    pending,
    error,
    setEnabled,
  }
}
