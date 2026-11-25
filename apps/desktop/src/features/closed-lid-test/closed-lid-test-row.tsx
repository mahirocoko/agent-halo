import { Laptop } from 'lucide-react'
import type { ClosedLidTestPhase } from './types'
import { useClosedLidTest } from './use-closed-lid-test'

export interface IClosedLidTestRowProps {
  canUseNativeControls: boolean
  batterySleepSupported: boolean
  startPending: boolean
  startError: string | null
  onEnableRequested: (result: Promise<string | null>) => void
}

const getStatusDetail = ({
  canUseNativeControls,
  batterySleepSupported,
  phase,
  pending,
  error,
}: {
  canUseNativeControls: boolean
  batterySleepSupported: boolean
  phase: ClosedLidTestPhase | null
  pending: boolean
  error: string | null
}): string => {
  if (!canUseNativeControls) return 'Desktop runtime required'
  if (error) return error
  if (pending && phase === null) return 'Checking status…'
  if (phase === 'starting' || (pending && phase === 'ready')) return 'Enabling…'
  if (phase === 'restoring' || (pending && phase === 'active')) return 'Restoring sleep settings…'
  if (phase === 'unavailable') return 'Unavailable'
  if (phase === 'ready' && !batterySleepSupported) return 'MacBook battery unavailable'
  if (phase === 'ready' || phase === 'active') return 'On battery only'
  return 'Checking status…'
}

export const ClosedLidTestRow = ({
  canUseNativeControls,
  batterySleepSupported,
  startPending,
  startError,
  onEnableRequested,
}: IClosedLidTestRowProps) => {
  // Reopening during confirmation waits for the original request before reading status.
  const { phase, pending: statusPending, error, setEnabled } = useClosedLidTest(canUseNativeControls && !startPending)
  const pending = statusPending || startPending
  const checked = phase === 'active' || phase === 'restoring'
  const busy = pending || phase === 'starting' || phase === 'restoring'
  const interactive = phase === 'ready' || phase === 'active'
  const switchDisabled =
    !canUseNativeControls || pending || !interactive || (!batterySleepSupported && phase === 'ready')
  const statusDetail = startPending
    ? 'Enabling…'
    : getStatusDetail({
        canUseNativeControls,
        batterySleepSupported,
        phase,
        pending,
        error: error ?? (phase === 'ready' ? startError : null),
      })

  return (
    <div className="setup-row" data-testid="closed-lid-test-row">
      <span className="status-slot">
        <Laptop className="setup-icon" size={14} strokeWidth={2.3} aria-hidden="true" />
      </span>
      <span className="setup-copy">
        <span className="setup-title">Keep awake with lid closed</span>
        <span className="setup-detail" role="status">
          {statusDetail}
        </span>
      </span>
      <button
        className={`pill-btn ${checked ? 'accent' : ''}`}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Keep awake with lid closed"
        aria-busy={busy}
        disabled={switchDisabled}
        onClick={() => {
          if (switchDisabled) return
          const result = setEnabled(!checked)
          if (!checked && result) onEnableRequested(result)
        }}
        data-tauri-drag-region="false"
      >
        {busy ? '…' : checked ? 'On' : 'Off'}
      </button>
    </div>
  )
}
