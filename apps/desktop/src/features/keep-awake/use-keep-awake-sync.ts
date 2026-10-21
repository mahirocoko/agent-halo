import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef, useState } from 'react'

const RETRY_DELAYS_MS = [750, 2_500] as const

// One independent serialized queue per assertion; Setup never owns native state.
export const useKeepAwakeSync = (
  canUseNativeControls: boolean,
  requestedActive: boolean,
  command: 'set_keep_awake' | 'set_system_keep_awake',
) => {
  const [active, setActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!canUseNativeControls) {
      setActive(false)
      setError(null)
      return undefined
    }
    let cancelled = false
    let retryTimer: number | null = null
    const syncNativeState = (attempt: number) => {
      const request = requestRef.current
        .catch(() => undefined)
        .then(() => invoke<boolean>(command, { active: requestedActive }))
        .then((confirmed) => {
          if (confirmed !== requestedActive) {
            throw new Error('Native keep-awake state did not match the requested state')
          }
          return confirmed
        })
      requestRef.current = request
      void request
        .then((confirmed) => {
          if (cancelled) return
          setActive(confirmed)
          setError(null)
        })
        .catch((cause) => {
          if (cancelled) return
          const retryDelay = RETRY_DELAYS_MS[attempt]
          if (retryDelay !== undefined) {
            retryTimer = window.setTimeout(() => syncNativeState(attempt + 1), retryDelay)
            return
          }
          setActive(false)
          setError(cause instanceof Error ? cause.message : String(cause || 'Keep awake unavailable'))
        })
    }
    setError(null)
    syncNativeState(0)
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [canUseNativeControls, requestedActive, command])

  return { active, error }
}
