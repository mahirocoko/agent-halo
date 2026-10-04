import { useEffect, useState } from 'react'

interface IBatterySleepControlsProps {
  armed: boolean
  pending: boolean
  error: string | null
  supported: boolean
  canUseNativeControls: boolean
  thresholdPercent: number
  onArmedChange: (armed: boolean) => void
  onThresholdChange: (thresholdPercent: number) => void
}

const BatterySleepControls = ({
  armed,
  pending,
  error,
  supported,
  canUseNativeControls,
  thresholdPercent,
  onArmedChange,
  onThresholdChange,
}: IBatterySleepControlsProps) => {
  const [draft, setDraft] = useState(String(thresholdPercent))
  const [touched, setTouched] = useState(false)
  const value = Number(draft)
  const valid = /^\d+$/.test(draft) && Number.isInteger(value) && value >= 1 && value <= 100
  const unsaved = !valid || value !== thresholdPercent

  useEffect(() => {
    setDraft(String(thresholdPercent))
    setTouched(false)
  }, [thresholdPercent])

  const saveDraft = () => {
    setTouched(true)
    if (!armed && !pending && valid && (unsaved || error)) onThresholdChange(value)
  }

  return (
    <span className="battery-sleep-controls" data-tauri-drag-region="false">
      <label className="battery-sleep-threshold">
        <input
          name="batterySleepThreshold"
          type="number"
          inputMode="numeric"
          min={1}
          max={100}
          step={1}
          required
          value={draft}
          aria-label="Sleep threshold percentage"
          aria-describedby="battery-sleep-threshold-hint"
          aria-invalid={touched && !valid}
          disabled={armed || pending || !canUseNativeControls || !supported}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={saveDraft}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.currentTarget.blur()
            } else if (event.key === 'Escape') {
              setDraft(String(thresholdPercent))
              setTouched(false)
            }
          }}
        />
        <span aria-hidden="true">%</span>
      </label>
      <button
        className={`pill-btn ${armed ? 'accent' : ''}`}
        type="button"
        role="switch"
        aria-checked={armed}
        aria-label="Low-battery sleep"
        disabled={pending || !canUseNativeControls || (!supported && !armed) || (!armed && unsaved)}
        onClick={() => onArmedChange(!armed)}
      >
        {pending ? '…' : armed ? 'On' : 'Off'}
      </button>
    </span>
  )
}

export { BatterySleepControls }
