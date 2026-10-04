import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { BatterySleepStatus } from './types'

export type UseBatterySleepResult = {
  armed: boolean
  thresholdPercent: number
  pending: boolean
  error: string | null
  supported: boolean
  batteryLevel: number | null
  isBatteryPowered: boolean | null
  setArmed: (armed: boolean) => void
  setThreshold: (thresholdPercent: number) => void
}

const BATTERY_SLEEP_EVENT = 'agent-halo://battery-sleep-status'

export const useBatterySleep = (canUseNativeControls: boolean): UseBatterySleepResult => {
  const [supported, setSupported] = useState(false)
  const [armed, setArmedState] = useState(false)
  const [thresholdPercent, setThresholdPercent] = useState(10)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null)
  const [isBatteryPowered, setIsBatteryPowered] = useState<boolean | null>(null)

  const requestRef = useRef<Promise<unknown>>(Promise.resolve())
  const generationRef = useRef(0)
  const lastAppliedGenRef = useRef(0)
  const pendingRef = useRef(false)

  const applyStatus = useCallback((status: BatterySleepStatus, gen: number) => {
    if (gen < lastAppliedGenRef.current) {
      return
    }
    lastAppliedGenRef.current = gen
    setSupported(status.supported)
    setArmedState(status.armed)
    setThresholdPercent(status.thresholdPercent)
    setError(status.error)
    setBatteryLevel(status.batteryLevel)
    setIsBatteryPowered(status.isBatteryPowered)
  }, [])

  useEffect(() => {
    if (!canUseNativeControls) {
      setSupported(false)
      setArmedState(false)
      setError(null)
      setBatteryLevel(null)
      setIsBatteryPowered(null)
      return undefined
    }

    let disposed = false
    let unlistenFn: (() => void) | null = null

    // UI listen must finish attaching BEFORE initial get!
    listen<BatterySleepStatus>(BATTERY_SLEEP_EVENT, (event) => {
      if (disposed) return
      const gen = ++generationRef.current
      applyStatus(event.payload, gen)
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup()
          return
        }
        unlistenFn = cleanup

        // Only after listener has attached, do initial get to cover remount/reload
        const currentGen = ++generationRef.current
        const request = requestRef.current
          .catch(() => undefined)
          .then(() => invoke<BatterySleepStatus>('get_battery_sleep_status'))
          .then((status) => {
            if (disposed) return
            applyStatus(status, currentGen)
          })
          .catch((err) => {
            if (disposed) return
            setError(err instanceof Error ? err.message : String(err || 'Failed to query battery sleep status'))
          })
        requestRef.current = request
      })
      .catch((err) => {
        if (disposed) return
        setError(err instanceof Error ? err.message : String(err || 'Failed to attach battery listener'))
      })

    return () => {
      disposed = true
      if (unlistenFn) {
        unlistenFn()
      }
    }
  }, [applyStatus, canUseNativeControls])

  const requestChange = useCallback(
    (command: string, args: Record<string, number | boolean>) => {
      if (!canUseNativeControls || pendingRef.current) return
      pendingRef.current = true
      setPending(true)

      const currentGen = ++generationRef.current
      const request = requestRef.current
        .catch(() => undefined)
        .then(() => invoke<BatterySleepStatus>(command, args))
        .then((status) => {
          applyStatus(status, currentGen)
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err || 'Failed to update battery sleep state'))
        })
        .finally(() => {
          pendingRef.current = false
          setPending(false)
        })
      requestRef.current = request
    },
    [applyStatus, canUseNativeControls],
  )

  const setArmed = useCallback((armed: boolean) => requestChange('set_battery_sleep_armed', { armed }), [requestChange])
  const setThreshold = useCallback(
    (thresholdPercent: number) => requestChange('set_battery_sleep_threshold', { thresholdPercent }),
    [requestChange],
  )

  return {
    armed,
    thresholdPercent,
    pending,
    error,
    supported,
    batteryLevel,
    isBatteryPowered,
    setArmed,
    setThreshold,
  }
}
